(function(_) {
'use strict';

const _isProxySupported = typeof Proxy !== 'undefined'
  && Proxy.toString().indexOf('proxies not supported on this platform') === -1;

// Use require conditionally, otherwise assume global dependencies.
if(typeof require !== 'undefined') {
  _ = require('lodash');
  
  if(!global._babelPolyfill) {
    // This should be replaced with runtime transformer when this bug is fixed:
    // https://phabricator.babeljs.io/T2877
    require('babel-polyfill');
  }

  // Patch the harmony-era (pre-ES6) Proxy object to be up-to-date with the ES6 spec.
  // Without the --harmony and --harmony_proxies flags, options strict: false and dotNotation: true will fail with exception.
  if(_isProxySupported === true) {
    require('harmony-reflect');
  }
} else {
  _ = window._;
}

// If reflection is being used, our traps will hide internal properties.
// If reflection is not being used, Symbol will hide internal properties.
const _privateKey = _isProxySupported === true ? '_private' : Symbol('_private');

// Reserved fields, map to internal property.
const _reservedFields = ['super'];

// Is a number (ignores type).
function isNumeric(n) {
  return !isNaN(parseFloat(n)) && isFinite(n);
}

// Used to get real index name.
function getIndex(index) {
  if(this[_privateKey]._options.keysIgnoreCase && typeof index === 'string') {
    const indexLowerCase = index.toLowerCase();
    for(const key in this[_privateKey]._schema) {
      if(typeof key === 'string' && key.toLowerCase() === indexLowerCase) {
        return key;
      }
    }
  }

  return index;
}

// Used to fetch current values.
function getter(value, properties) {
  // Most calculations happen within the typecast and the value passed is typically the value we want to use.
  // Typically, the getter just returns the value.
  // Modifications to the value within the getter are not written to the object.

  // Getter can transform value after typecast.
  if(properties.getter) {
    value = properties.getter.call(this[_privateKey]._root, value);
  }

  return value;
}

// Used to write value to object.
function writeValue(value, fieldSchema) {
  // onBeforeValueSet allows you to cancel the operation.
  // It doesn't work like transform and others that allow you to modify the value because all typecast has already happened.
  // For use-cases where you need to modify the value, you can set a new value in the handler and return false.
  if(this[_privateKey]._options.onBeforeValueSet) {
    if(this[_privateKey]._options.onBeforeValueSet.call(this, value, fieldSchema.name) === false) {
      return;
    }
  }

  // Alias simply copies the value without actually writing it to alias index.
  // Because the value isn't actually set on the alias index, onValueSet isn't fired.
  if(fieldSchema.type === 'alias') {
    this[fieldSchema.index] = value;
    return;
  }

  // Write the value to the inner object.
  this[_privateKey]._obj[fieldSchema.name] = value;

  // onValueSet notifies you after a value has been written.
  if(this[_privateKey]._options.onValueSet) {
    this[_privateKey]._options.onValueSet.call(this, value, fieldSchema.name);
  }
}

// Represents an error encountered when trying to set a value.
class SetterError {
  constructor(errorMessage, setValue, originalValue, fieldSchema) {
    this.errorMessage = errorMessage;
    this.setValue = setValue;
    this.originalValue = originalValue;
    this.fieldSchema = fieldSchema;
  }
}

// Returns typecasted value if possible. If rejected, originalValue is returned.
function typecast(value, originalValue, properties) {
  const options = this[_privateKey]._options;

  // Allow transform to manipulate raw properties.
  if(properties.transform) {
    value = properties.transform.call(this[_privateKey]._root, value, originalValue, properties);
  }

  // Allow null to be preserved.
  if(value === null && options.preserveNull) {
    return null;
  }

  // Property types are always normalized as lowercase strings despite shorthand definitions being available.
  switch(properties.type) {
    case 'string':
      // Reject if object or array.
      if(_.isObject(value) || _.isArray(value)) {
        throw new SetterError('String type cannot typecast Object or Array types.', value, originalValue, properties);
      }

      // If index is being set with null or undefined, set value and end.
      if(value === undefined || value === null) {
        return undefined;
      }

      // Typecast to String.
      value = value + '';

      // If stringTransform function is defined, use.
      // This is used before we do validation checks (except to be sure we have a string at all).
      if(properties.stringTransform) {
        value = properties.stringTransform.call(this[_privateKey]._root, value, originalValue, properties);
      }

      // If clip property & maxLength properties are set, the string should be clipped.
      // This is basically a shortcut property that could be done with stringTransform.
      if(properties.clip !== undefined && properties.maxLength !== undefined) {
        value = value.substr(0, properties.maxLength);
      }

      // If enum is being used, be sure the value is within definition.
      if(_.isArray(properties.enum) && properties.enum.indexOf(value) === -1) {
        throw new SetterError('String does not exist in enum list.', value, originalValue, properties);
      }

      // If minLength is defined, check to be sure the string is > minLength.
      if(properties.minLength !== undefined && value.length < properties.minLength) {
        throw new SetterError('String length too short to meet minLength requirement.', value, originalValue, properties);
      }

      // If maxLength is defined, check to be sure the string is < maxLength.
      if(properties.maxLength !== undefined && value.length > properties.maxLength) {
        throw new SetterError('String length too long to meet maxLength requirement.', value, originalValue, properties);
      }

      // If regex is defined, check to be sure the string matches the regex pattern.
      if(properties.regex && !properties.regex.test(value)) {
        throw new SetterError('String does not match regular expression pattern.', value, originalValue, properties);
      }

      return value;

    case 'number':
      // If index is being set with null, undefined, or empty string: clear value.
      if(value === undefined || value === null || value === '') {
        return undefined;
      }

      // Set values for boolean.
      if(_.isBoolean(value)) {
        value = value ? 1 : 0;
      }

      // Remove comma from strings.
      if(typeof value === 'string') {
        value = value.replace(/,/g, '');
      }

      // Reject if array, object, or not numeric.
      if( _.isArray(value) || _.isObject(value) || !isNumeric(value)) {
        throw new SetterError('Number type cannot typecast Array or Object types.', value, originalValue, properties);
      }

      // Typecast to number.
      value = value * 1;

      // Transformation after typecasting but before validation and filters.
      if(properties.numberTransform) {
        value = properties.numberTransform.call(this[_privateKey]._root, value, originalValue, properties);
      }

      if(properties.min !== undefined && value < properties.min) {
        throw new SetterError('Number is too small to meet min requirement.', value, originalValue, properties);
      }

      if(properties.max !== undefined && value > properties.max) {
        throw new SetterError('Number is too big to meet max requirement.', value, originalValue, properties);
      }

      return value;

    case 'boolean':
      // If index is being set with null, undefined, or empty string: clear value.
      if(value === undefined || value === null || value === '') {
        return undefined;
      }

      // If is String and is 'false', convert to Boolean.
      if(value === 'false') {
        return false;
      }

      // If is Number, <0 is true and >0 is false.
      if(isNumeric(value)) {
        return (value * 1) > 0 ? true : false;
      }

      // Use Javascript to eval and return boolean.
      value = value ? true : false;

      // Transformation after typecasting but before validation and filters.
      if(properties.booleanTransform) {
        value = properties.booleanTransform.call(this[_privateKey]._root, value, originalValue, properties);
      }

      return value;

    case 'array':
      // If it's an object, typecast to an array and return array.
      if(_.isObject(value)) {
        value = _.toArray(value);
      }

      // Reject if not array.
      if(!_.isArray(value)) {
        throw new SetterError('Array type cannot typecast non-Array types.', value, originalValue, properties);
      }

      // Arrays are never set directly.
      // Instead, the values are copied over to the existing SchemaArray instance.
      // The SchemaArray is initialized immediately and will always exist.
      originalValue.length = 0;
      _.each(value, (arrayValue) => {
        originalValue.push(arrayValue);
      });

      return originalValue;

    case 'object':
      // If it's not an Object, reject.
      if(!_.isObject(value)) {
        throw new SetterError('Object type cannot typecast non-Object types.', value, originalValue, properties);
      }

      // If object is schema object and an entirely new object was passed, clear values and set.
      // This preserves the object instance.
      if(properties.objectType) {
        // The object will usually exist because it's initialized immediately for deep access within SchemaObjects.
        // However, in the case of Array elements, it will not exist.
        let schemaObject;
        if(originalValue !== undefined) {
          // Clear existing values.
          schemaObject = originalValue;
          schemaObject.clear();
        } else {
          // The SchemaObject doesn't exist yet. Let's initialize a new one.
          // This is used for Array types.
          schemaObject = new properties.objectType({}, this[_privateKey]._root);
        }

        // Copy value to SchemaObject and set value to SchemaObject.
        for(const key in value) {
          schemaObject[key] = value[key];
        }
        value = schemaObject;
      }

      // Otherwise, it's OK.
      return value;

    case 'date':
      // If index is being set with null, undefined, or empty string: clear value.
      if(value === undefined || value === null || value === '') {
        return undefined;
      }

      // Reject if object, array or boolean.
      if(!_.isDate(value) && !_.isString(value) && !_.isNumber(value)) {
        throw new SetterError('Date type cannot typecast Array or Object types.', value, originalValue, properties);
      }

      // Attempt to parse string value with Date.parse (which returns number of milliseconds).
      if(_.isString(value)) {
        value = Date.parse(value);
      }

      // If is timestamp, convert to Date.
      if(isNumeric(value)) {
        value = new Date((value + '').length > 10 ? value : value * 1000);
      }

      // If the date couldn't be parsed, do not modify index.
      if(value == 'Invalid Date' || !_.isDate(value)) {
        throw new SetterError('Could not parse date.', value, originalValue, properties);
      }

      // Transformation after typecasting but before validation and filters.
      if(properties.dateTransform) {
        value = properties.dateTransform.call(this[_privateKey]._root, value, originalValue, properties);
      }

      return value;

    default: // 'any'
      return value;
  }
}

// Properties can be passed in multiple forms (an object, just a type, etc).
// Normalize to a standard format.
function normalizeProperties(properties, name) {
  // Allow for shorthand type declaration:

  // Check to see if the user passed in a raw type of a properties hash.
  if(properties) {
    // Raw type passed.
    // index: Type is translated to index: {type: Type}
    // Properties hash created.
    if(properties.type === undefined) {
      properties = {type: properties};

    // Properties hash passed.
    // Copy properties hash before modifying.
    // Users can pass in their own custom types to the schema and we don't want to write to that object.
    // Especially since properties.name contains the index of our field and copying that will break functionality.
    } else {
      properties = _.cloneDeep(properties);
    }
  }

  // Type may be an object with properties.
  // If "type.type" exists, we'll assume it's meant to be properties.
  // This means that shorthand objects can't use the "type" index.
  // If "type" is necessary, they must be wrapped in a SchemaObject.
  if(_.isObject(properties.type) && properties.type.type !== undefined) {
    _.each(properties.type, (value, key) => {
      if(properties[key] === undefined) {
        properties[key] = value;
      }
    });
    properties.type = properties.type.type;
  }

  // Null or undefined should be flexible and allow any value.
  if(properties.type === null || properties.type === undefined) {
    properties.type = 'any';

  // Convert object representation of type to lowercase string.
  // String is converted to 'string', Number to 'number', etc.
  // Do not convert the initialized SchemaObjectInstance to a string!
  // Check for a shorthand declaration of schema by key length.
  } else if(_.isString(properties.type.name) && properties.type.name !== 'SchemaObjectInstance'
    && Object.keys(properties.type).length === 0) {
    properties.type = properties.type.name;
  }
  if(_.isString(properties.type)) {
    properties.type = properties.type.toLowerCase();
  }

  // index: [Type] or index: [] is translated to index: {type: Array, arrayType: Type}
  if(_.isArray(properties.type)) {
    if(_.size(properties.type)) {
      // Properties will be normalized when array is initialized.
      properties.arrayType = properties.type[0];
    }
    properties.type = 'array';
  }

  // index: {} or index: SchemaObject is translated to index: {type: Object, objectType: Type}
  if(!_.isString(properties.type)) {
    if(_.isFunction(properties.type)) {
      properties.objectType = properties.type;
      properties.type = 'object';
    } else if(_.isObject(properties.type)) {
      // When an empty object is passed, no schema is enforced.
      if(_.size(properties.type)) {
        // Options should be inherited by sub-SchemaObjects, except toObject.
        const options = _.clone(this[_privateKey]._options);
        delete options.toObject;

        // When we're creating a nested schema automatically, it should always inherit the root "this".
        options.inheritRootThis = true;

        // Initialize the SchemaObject sub-schema automatically.
        properties.objectType = new SchemaObject(properties.type, options);
      }

      // Regardless of if we created a sub-schema or not, the field is indexed as an object.
      properties.type = 'object';
    }
  }

  // Set name if passed on properties.
  // It's used to show what field an error what generated on.
  if(name) {
    properties.name = name;
  }

  return properties;
}

// Add field to schema and initializes getter and setter for the field.
function addToSchema(index, properties) {
  this[_privateKey]._schema[index] = normalizeProperties.call(this, properties, index);

  defineGetter.call(this[_privateKey]._getset, index, this[_privateKey]._schema[index]);
  defineSetter.call(this[_privateKey]._getset, index, this[_privateKey]._schema[index]);
}

// Defines getter for specific field.
function defineGetter(index, properties) {
  // If the field type is an alias, we retrieve the value through the alias's index.
  let indexOrAliasIndex = properties.type === 'alias' ? properties.index : index;

  this.__defineGetter__(index, () => {
    // If accessing object or array, lazy initialize if not set.
    if(!this[_privateKey]._obj[indexOrAliasIndex] && (properties.type === 'object' || properties.type === 'array')) {
      // Initialize object.
      if(properties.type === 'object') {
        if(properties.default !== undefined) {
          writeValue.call(this[_privateKey]._this, _.isFunction(properties.default)
            ? properties.default.call(this)
            : properties.default, properties);
        } else {
          writeValue.call(this[_privateKey]._this,
            properties.objectType ? new properties.objectType({}, this[_privateKey]._root) : {}, properties);
        }

      // Native arrays are not used so that Array class can be extended with custom behaviors.
      } else if(properties.type === 'array') {
        writeValue.call(this[_privateKey]._this, new SchemaArray(this, properties), properties);
      }
    }

    try {
      return getter.call(this, this[_privateKey]._obj[indexOrAliasIndex], properties);
    } catch(error) {
      // This typically happens when the default value isn't valid -- log error.
      this[_privateKey]._errors.push(error);
    }
  });
}

// Defines setter for specific field.
function defineSetter(index, properties) {
  this.__defineSetter__(index, (value) => {
    // Don't proceed if readOnly is true.
    if(properties.readOnly) {
      return;
    }

    try {
      // this[_privateKey]._this[index] is used instead of this[_privateKey]._obj[index] to route through the public interface.
      writeValue.call(this[_privateKey]._this,
        typecast.call(this, value, this[_privateKey]._this[index], properties), properties);
    } catch(error) {
      // Setter failed to validate value -- log error.
      this[_privateKey]._errors.push(error);
    }
  });
}

// Reset field to default value.
function clearField(index, properties) {
  // Aliased fields reflect values on other fields and do not need to be cleared.
  if(properties.isAlias === true) {
    return;
  }

  // In case of object & array, they must be initialized immediately.
  if(properties.type === 'object') {
    this[properties.name].clear();

  // Native arrays are never used so that toArray can be globally supported.
  // Additionally, other properties such as unique rely on passing through SchemaObject.
  } else if(properties.type === 'array') {
    this[properties.name].length = 0;

  // Other field types can simply have their value set to undefined.
  } else {
    writeValue.call(this[_privateKey]._this, undefined, properties);
  }
}

// Represents a basic array with typecasted values.
class SchemaArray extends Array {
  constructor(self, properties) {
    super();

    // Store all internals.
    const _private = this[_privateKey] = {};

    // Store reference to self.
    _private._self = self;

    // Store properties (arrayType, unique, etc).
    _private._properties = properties;

    // Normalize our own properties.
    if(properties.arrayType) {
      properties.arrayType = normalizeProperties.call(self, properties.arrayType);
    }
  }

  push(...args) {
    // Values are passed through the typecast before being allowed onto the array if arrayType is set.
    // In the case of rejection, the typecast returns undefined, which is not appended to the array.
    let values;
    if(this[_privateKey]._properties.arrayType) {
      values = [].map.call(args, (value) => {
        return typecast.call(this[_privateKey]._self, value, undefined, this[_privateKey]._properties.arrayType);
      }, this);
    } else {
      values = args;
    }

    // Enforce filter.
    if(this[_privateKey]._properties.filter) {
      values = _.filter(values, (value) => this[_privateKey]._properties.filter.call(this, value));
    }

    // Enforce uniqueness.
    if(this[_privateKey]._properties.unique) {
      values = _.difference(values, _.toArray(this));
    }

    return Array.prototype.push.apply(this, values);
  }

  concat(...args) {
    // Return new instance of SchemaArray.
    const schemaArray = new SchemaArray(this[_privateKey]._self, this[_privateKey]._properties);

    // Create primitive array with all elements.
    let array = this.toArray();

    for(const i in args) {
      if(args[i].toArray) {
        args[i] = args[i].toArray();
      }
      array = array.concat(args[i]);
    }

    // Push each value in individually to typecast.
    for(const i in array) {
      schemaArray.push(array[i]);
    }

    return schemaArray;
  }

  toArray() {
    // Create new Array to hold elements.
    const array = [];

    // Loop through each element, clone if necessary.
    _.each(this, (element) => {
      // Call toObject() method if defined (this allows us to return primitive objects instead of SchemaObjects).
      if(_.isObject(element) && _.isFunction(element.toObject)) {
        element = element.toObject();

      // If is non-SchemaType object, shallow clone so that properties modification don't have an affect on the original object.
      } else if(_.isObject(element)) {
        element = _.clone(element);
      }

      array.push(element);
    });

    return array;
  }

  toJSON() {
    return this.toArray();
  }

  // Used to detect instance of SchemaArray internally.
  _isSchemaArray() {
    return true;
  }
}

// Represents an object FACTORY with typed indexes.
class SchemaObject {
  constructor(schema, options = {}) {
    // Create object for options if doesn't exist and merge with defaults.
    options = _.extend({
      // By default, allow only values in the schema to be set.
      // When this is false, setting new fields will dynamically add the field to the schema as type "any". 
      strict: true,

      // Allow fields to be set via dotNotation; obj['user.name'] = 'Scott'; -> obj: { user: 'Scott' }
      dotNotation: false,

      // Do not set undefined values to keys within toObject().
      // This is the default because MongoDB will convert undefined to null and overwrite existing values.
      // If this is true, toObject() will output undefined for unset primitives and empty arrays/objects for those types.
      // If this is false, toObject() will not output any keys for unset primitives, arrays, and objects.
      setUndefined: false,

      // If this is set to true, null will NOT be converted to undefined automatically.
      // In many cases, when people use null, they actually want to unset a value.
      // There are rare cases where preserving the null is important.
      // Set to true if you are one of those rare cases.
      preserveNull: false,

      // Allow "profileURL" to be set with "profileUrl" when set to false
      keysIgnoreCase: false,

      // Inherit root object "this" context from parent SchemaObject.
      inheritRootThis: false
    }, options);

    // Some of the options require reflection.
    if(_isProxySupported === false) {
      if(!options.strict) {
        throw new Error('[schema-object] Turning strict mode off requires --harmony flag.');
      }
      if(options.dotNotation) {
        throw new Error('[schema-object] Dot notation support requires --harmony flag.');
      }
      if(options.keysIgnoreCase) {
        throw new Error('[schema-object] Keys ignore case support requires --harmony flag.');
      }
    }

    // Used at minimum to hold default constructor.
    if(!options.constructors) {
      options.constructors = {};
    }

    // Default constructor can be overridden.
    if(!options.constructors.default) {
      // By default, populate runtime values as provided to this instance of object.
      options.constructors.default = function(values) {
        this.populate(values);
      };
    }

    // Create SchemaObject factory.
    const SO = SchemaObjectInstanceFactory(schema, options);

    // Add custom constructors.
    _.each(options.constructors, (method, key) => {
      SO[key] = function() {
        // Initialize new SO.
        const obj = new SO();

        // Expose default constructor to populate defaults.
        obj[_privateKey]._reservedFields.super = function() {
          options.constructors.default.apply(obj, arguments);
        };

        // Call custom constructor.
        method.apply(obj, arguments);;

        // Cleanup and return SO.
        delete obj[_privateKey]._reservedFields.super;
        return obj;
      };
    });

    return SO;
  }
}

// Represents an object INSTANCE factory with typed indexes.
function SchemaObjectInstanceFactory(schema, options) {
  // Represents an actual instance of an object.
  class SchemaObjectInstance {
    // Extend instance factory.
    static extend(extendSchema, extendOptions) {
      // Extend requires reflection.
      if(_isProxySupported === false) {
        throw new Error('[schema-object] Extending object requires --harmony flag.');
      }

      // Merge schema and options together.
      const mergedSchema = _.merge({}, schema, extendSchema);
      const mergedOptions = _.merge({}, options, extendOptions);

      // Allow method and constructor to call `this.super()`.
      const methodHomes = ['methods', 'constructors'];
      for(const methodHome of methodHomes) {
        // Ensure object containing methods exists on both provided and original options.
        if(_.size(options[methodHome]) && _.size(extendOptions[methodHome])) {
          // Loop through each method in the original options.
          // It's not necessary to bind `this.super()` for options that didn't already exist.
          _.each(options[methodHome], (method, name) => {
            // The original option may exist, but was it extended?
            if(extendOptions[methodHome][name]) {
              // Extend method by creating a binding that takes the `this` context given and adds `self`.
              // `self` is a reference to the original method, also bound to the correct `this`.
              mergedOptions[methodHome][name] = function() {
                this[_privateKey]._reservedFields.super = () => {
                  return method.apply(this, arguments);
                };
                const ret = extendOptions[methodHome][name].apply(this, arguments);
                delete this[_privateKey]._reservedFields.super;
                return ret;
              };
            }
          });
        }
      }

      return new SchemaObject(mergedSchema, mergedOptions);
    }

    // Construct new instance pre-populated with values.
    constructor(values, _root) {
      // Object used to store internals.
      const _private = this[_privateKey] = {};

      //
      _private._root = options.inheritRootThis ? _root || this : this;

      // Object with getters and setters bound.
      _private._getset = this;

      // Public version of ourselves.
      // Overwritten with proxy if available.
      _private._this = this;

      // Object used to store raw values.
      const obj = _private._obj = {};

      // Schema as defined by constructor.
      _private._schema = schema;

      // Errors, retrieved with getErrors().
      _private._errors = [];

      // Options need to be accessible. Shared across ALL INSTANCES.
      _private._options = options;

      // Reserved keys for storing internal properties accessible from outside.
      _private._reservedFields = {};

      // Normalize schema properties to allow for shorthand declarations.
      _.each(schema, (properties, index) => {
        schema[index] = normalizeProperties.call(this, properties, index);
      });

      // Define getters/typecasts based off of schema.
      _.each(schema, (properties, index) => {
        // Use getter / typecast to intercept and re-route, transform, etc.
        defineGetter.call(_private._getset, index, properties);
        defineSetter.call(_private._getset, index, properties);
      });

      // Proxy used as interface to object allows to intercept all access.
      // Without Proxy we must register individual getter/typecasts to put any logic in place.
      // With Proxy, we still use the individual getter/typecasts, but also catch values that aren't in the schema.
      if(_isProxySupported === true) {
        const proxy = this[_privateKey]._this = new Proxy(this, {
          // Ensure only public keys are shown.
          ownKeys: (target) => {
            return Object.keys(this.toObject());
          },

          // Return keys to iterate.
          enumerate: (target) => {
            return Object.keys(this[_privateKey]._this)[Symbol.iterator]();
          },

          // Check to see if key exists.
          has: (target, key) => {
            return !!_private._getset[key];
          },

          // Ensure correct prototype is returned.
          getPrototypeOf: () => {
            return _private._getset;
          },

          // Ensure readOnly fields are not writeable.
          getOwnPropertyDescriptor: (target, key) => {
            return {
              value: proxy[key],
              writeable: !schema[key] || schema[key].readOnly !== true,
              enumerable: true,
              configurable: true
            };
          },

          // Intercept all get calls.
          get: (target, name, receiver) => {
            // First check to see if it's a reserved field.
            if(_reservedFields.includes(name)) {
              return this[_privateKey]._reservedFields[name];
            }

            // Support dot notation via lodash.
            if(options.dotNotation && name.indexOf('.') !== -1) {
              return _.get(this[_privateKey]._this, name);
            }

            // Use registered getter without hitting the proxy to avoid creating an infinite loop.
            return this[name];
          },

          // Intercept all set calls.
          set: (target, name, value, receiver) => {
            // Support dot notation via lodash.
            if(options.dotNotation && name.indexOf('.') !== -1) {
              return _.set(this[_privateKey]._this, name, value);
            }

            // Find real keyname if case sensitivity is off.
            if(options.keysIgnoreCase && !schema[name]) {
              name = getIndex.call(this, name);
            }

            if(!schema[name]) {
              if(options.strict) {
                // Strict mode means we don't want to deal with anything not in the schema.
                // TODO: SetterError here.
                return true;
              } else {
                // Add index to schema dynamically when value is set.
                // This is necessary for toObject to see the field.
                addToSchema.call(this, name, {type: 'any'});
              }
            }

            // This hits the registered setter but bypasses the proxy to avoid an infinite loop.
            this[name] = value;

            // Necessary for Node v6.0. Prevents error: 'set' on proxy: trap returned falsish for property 'string'".
            return true;
          },

          // Intercept all delete calls.
          deleteProperty: (target, property) => {
            this[property] = undefined;
            return true;
          }
        });
      }

      // Populate schema defaults into object.
      _.each(schema, (properties, index) => {
        if(properties.default !== undefined) {
          // Temporarily ensure readOnly is turned off to prevent the set from failing.
          const readOnly = properties.readOnly;
          properties.readOnly = false;
          this[index] = _.isFunction(properties.default) ? properties.default.call(this) : properties.default;
          properties.readOnly = readOnly;
        }
      });

      // Call default constructor.
      _private._options.constructors.default.call(this, values);

      // May return actual object instance or Proxy, depending on harmony support.
      return _private._this;
    }

    // Populate values.
    populate(values) {
      for(const key in values) {
        this[_privateKey]._this[key] = values[key];
      }
    }

    // Clone and return SchemaObject.
    clone() {
      return new SchemaObjectInstance(this.toObject(), this[_privateKey]._root);
    }

    // Return object without getter/typecasts, extra properties, etc.
    toObject() {
      const options = this[_privateKey]._options;
      let getObj = {};

      // Populate all properties in schema.
      _.each(this[_privateKey]._schema, (properties, index) => {
        // Do not write values to object that are marked as invisible.
        if(properties.invisible) {
          return;
        }

        // Fetch value through the public interface.
        let value = this[_privateKey]._this[index];

        // Do not write undefined values to the object because of strange behavior when using with MongoDB.
        // MongoDB will convert undefined to null and overwrite existing values in that field.
        if(value === undefined && options.setUndefined !== true) {
          return;
        }

        // Clone objects so they can't be modified by reference.
        if(_.isObject(value)) {
          if(value._isSchemaObject) {
            value = value.toObject();
          } else if(value._isSchemaArray) {
            value = value.toArray();
          } else if(_.isArray(value)) {
            value = value.splice(0);
          } else if(_.isDate(value)) {
            // https://github.com/documentcloud/underscore/pull/863
            // _.clone doesn't work on Date object.
            getObj[index] = new Date(value.getTime());
          } else {
            value = _.clone(value);
          }

          // Don't write empty objects or arrays.
          if(!_.isDate(value) && !options.setUndefined && !_.size(value)) {
            return;
          }
        }

        // Write to object.
        getObj[index] = value;
      });

      // If options contains toObject, pass through before returning final object.
      if(_.isFunction(options.toObject)) {
        getObj = options.toObject.call(this, getObj);
      }

      return getObj;
    }

    // toJSON is an interface used by JSON.stringify.
    // Return the raw object if called.
    toJSON() {
      return this.toObject();
    }

    // Clear all values.
    clear() {
      _.each(this[_privateKey]._schema, (properties, index) => {
        clearField.call(this[_privateKey]._this, index, properties);
      });
    }

    // Get all errors.
    getErrors() {
      const errors = [];
      for(let error of this[_privateKey]._errors) {
        error = _.cloneDeep(error);
        error.schemaObject = this;
        errors.push(error);
      }

      // Look for sub-SchemaObjects.
      for(const name in this[_privateKey]._schema) {
        const field = this[_privateKey]._schema[name];
        if(field.type === 'object' && typeof field.objectType === 'function') {
          const subErrors = this[name].getErrors();
          for(const subError of subErrors) {
            subError.fieldSchema.name = `${name}.${subError.fieldSchema.name}`;
            subError.schemaObject = this;
            errors.push(subError);
          }
        }
      }

      return errors;
    }

    // Clear all errors
    clearErrors() {
      this[_privateKey]._errors.length = 0;

      // Look for sub-SchemaObjects.
      for(const name in this[_privateKey]._schema) {
        const field = this[_privateKey]._schema[name];
        if(field.type === 'object' && typeof field.objectType === 'function') {
          this[name].clearErrors();
        }
      }
    }

    // Has errors?
    isErrors() {
      return this.getErrors().length > 0;
    }

    // Used to detect instance of schema object internally.
    _isSchemaObject() {
      return true;
    }
  }

  // Add custom methods to factory-generated class.
  _.each(options.methods, (method, key) => {
    if(SchemaObjectInstance.prototype[key]) {
      throw new Error(`Cannot overwrite existing ${key} method with custom method.`);
    }
    SchemaObjectInstance.prototype[key] = method;
  });

  return SchemaObjectInstance;
}

if(typeof module === 'object') {
  module.exports = SchemaObject;
} else if(typeof window === 'object') {
  window.SchemaObject = SchemaObject;
} else {
  throw new Error('[schema-object] Error: module.exports and window are unavailable.');
}

})();