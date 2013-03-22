var _ = require('underscore')._;

// Helper functions:

// Is a number (ignores type).
var isNumeric = function(n) {
  return !isNaN(parseFloat(n)) && isFinite(n);
}

// Used to fetch current values.
var getter = function(value, properties) {
  // Most calculations happen within the setter and the value passed is typically the value we want to use.
  // Typically, the getter just returns the value.
  // Modifications to the value within the getter are not written to the object.

  // Return default value if present & current value is undefined -- do not write to object
  if(_.isUndefined(value) && !_.isUndefined(properties.default)) {
    value = setter.call(this, (_.isFunction(properties.default) ? properties.default.call(this) : properties.default), value, properties);
  }

  return value;
}

// Returns typecasted value if possible. If rejected, originalValue is returned.
var setter = function(value, originalValue, properties) {
  // Allow transform to manipulate raw properties.
  if(properties.transform) {
    value = properties.transform.call(this, value, originalValue, properties);
  }

  switch(properties.type) {
    case 'string':
      // Reject if object or array.
      if(_.isObject(value) || _.isArray(value)) {
        return originalValue;
      }

      // If index is being set with null or undefined, set value and end.
      if(_.isUndefined(value) || value === null) {
        return value;
      }

      // Typecast to String.
      value = value + '';

      // If stringTransform function is defined, use iproperties.
      // This is used before we do validation checks (except to be sure we have a string at all).
      if(properties.stringTransform) {
        value = properties.stringTransform.call(this, value, originalValue, properties);
      }

      // Check against filters before returning value
      if(
        // If enum is being used, be sure the value is within definition.
        (_.isArray(properties.enum) && properties.enum.indexOf(value) === -1)

        // If minLength is defined, check to be sure the string is > minLength
        || (!_.isUndefined(properties.minLength) && value.length < properties.minLength)

        // If regex is defined, check to be sure the string matches the regex pattern.
        || (properties.regex && !properties.regex.test(value))
      ) {
        // If the string doesn't meet requirements, it will remain untouched.
        return originalValue;
      }

      return value;
    break;

    case 'number':
      // Set values for boolean.
      if(_.isBoolean(value)) {
        value = value ? 1 : 0;
      }

      if(
        // Reject if array.
        _.isArray(value)

        // Reject if object.
        || _.isObject(value)

        // Reject if not numeric.
        || !isNumeric(value)
      ) {
         // If the value doesn't meet requirements, it will remain untouched.
        return originalValue;
      }

      // Typecast to number.
      value = value * 1;

      // Check against filters before returning value
      if(
        // If min is defined, check to be sure the integer is > min
        (!_.isUndefined(properties.min) && value < properties.min)

        // If max is defined, check to be sure the string is < max
        || (!_.isUndefined(properties.max) && value > properties.max)
      ) {
        // If the string doesn't meet requirements, it will remain untouched.
        return originalValue;
      }

      return value;
    break;

    case 'boolean':
      // If is String and is 'false', return false.
      if(_.isString(value) && value === 'false') {
        return false;
      }

      // If is Number, <0 is true and >0 is false.
      if(isNumeric(value)) {
        value = value * 1;
        return value > 0 ? true : false;
      }

      // Use Javascript to eval and return boolean.
      return value ? true : false;
    break;

    case 'array':
      // If it's an object, typecast to an array and return array.
      if(_.isObject(value)) {
        value = _.toArray(value);
      }

      // Reject if not array
      if(!_.isArray(value)) {
        // If the value doesn't meet requirements, it will remain untouched.
        return originalValue;
      }

      return value;
    break;

    case 'object':
      // If it's not an Object, reject.
      if(!_.isObject(value)) {
        // If the value doesn't meet requirements, it will remain untouched.
        return originalValue;
      }

      // If object is schema object and an entirely new object was passed, clear values and set.
      // This preserves the object instance.
      if(properties.objectType) {
        // The object will usually exist because it's initialized immediately for deep access within SchemaObjects.
        // However, in the case of Array elements, it will not exist.
        var schemaObject;
        if(!_.isUndefined(originalValue)) {
          // Clear existing values.
          schemaObject = originalValue;
          schemaObject.clear();
        } else {
          // The SchemaObject doesn't exist yet. Let's initialize a new one.
          // This is used for Array types.
          schemaObject = new properties.objectType;
        }

        // Copy value to SchemaObject and set value to SchemaObject.
        _.each(value, function(v, k) {
          schemaObject[k] = v;
        });
        value = schemaObject;
      }

      // Otherwise, it's OK.
      return value;
    break;

    case 'date':
      // Reject if object, array or boolean.
      if(_.isObject(value) || _.isArray(value) || _.isBoolean(value)) {
        return originalValue;
      }

      // Attempt to parse string value with Date.parse (which returns number of milliseconds).
      if(_.isString(value)) {
        value = Date.parse(value);
      }

      // If is timestamp, convert to Date.
      if(_.isNumber(value)) {
        value = new Date(value > 9999999999 ? value : value * 1000);
      }

      // If the date couldn't be parsed, do not modify index.
      if(value == 'Invalid Date' || !_.isDate(value)) {
        value = originalValue;
      }

      return value;
    break;

    default:
      return value;
    break;
  }
};

// Properties can be passed in multiple forms (an object, just a type, etc).
// Normalize to a standard format.
var normalizeProperties = function(properties) {
  // Allow for shorthand type declaration:

  // index: Type is translated to index: {type: Type}
  if(properties && _.isUndefined(properties.type)) {
    properties = {type: properties};
  }

  // Null or undefined should be flexible and allow any value.
  if(properties.type === null || properties.type === undefined) {
    properties.type = 'any';

  // Convert object representation of type to lowercase string.
  // String is converted to 'string', Number to 'number', etc.
  } else if(properties.type.name) {
    properties.type = properties.type.name;
  }
  if(_.isString(properties.type)) {
    properties.type = properties.type.toLowerCase();
  }

  // index: [Properties] or index: [] is translated to index: {type: Array, arrayProperties: Properties}
  if(_.isArray(properties.type)) {
    if(_.size(properties.type)) {
      // Properties will be normalized when array is initialized.
      properties.arrayProperties = properties.type[0];
    }
    properties.type = 'array';
  }

  // index: {} or index: {schema: Type} or index: SchemaObject is translated to index: {type: Object, objectType: Type}
  // SchemaObject factory is initialized when raw schema is provided.
  if(!_.isString(properties.type)) {
    if(_.isFunction(properties.type)) {
      properties.objectType = properties.type;
      properties.type = 'object';
    } else if(properties.type === {}) {
      properties.type = 'object';
    } else if(_.isObject(properties.type) && _.size(properties.type)) {
      properties.objectType = new SchemaObject(properties.type);
      properties.type = 'object';
    }
  }

  return properties;
}

// Represents a basic array with typecasted values.
var SchemaArray = function(self, properties) {
  this._self = self;

  this._properties = _.clone(properties);
  this._properties = properties.arrayProperties;
  delete this._properties.arrayProperties;
  this._properties = normalizeProperties(this._properties);
}
SchemaArray.prototype = new Array;
SchemaArray.prototype.push = function() {
  var values = [].map.call(arguments, function(value) {
    return setter.call(this._self, value, undefined, this._properties);
  }, this);
  var ret = [].push.apply(this, values);
  return ret;
}

// Represents an object with typed indexes.
var SchemaObject = function(schema) {
  return function(defaults) {
    var self = this;

    // Object used to store properties internally.
    var obj;
    self._obj = obj = {};

    // Schema as defined by constructor.
    self._schema = schema;

    // Define getters/setters based off of schema.
    _.each(schema, function(properties, index) {
      // Normalize properties to allow for various shorthand declarations.
      schema[index] = properties = normalizeProperties(properties);

      // The actual index on the object may be an alias.
      var objIndex = index;
      if(properties.type === 'alias') {
        // Use properties of referenced index.
        // TODO: Allow for alias to be recognized via dot-notation.
        objIndex = properties.index;
        var referencedProperties = normalizeProperties(schema[objIndex]);
        referencedProperties.isAlias = true;

        // Allow alias to use transform() to pre-transform any values passing through it.
        if(properties.transform) {
          referencedProperties.transform = function(value, originalValue, properties) {
            value = properties.transform.call(this, value, originalValue, properties);
            value = referencedProperties.transform.call(this, value, originalValue, properties);
            return value;
          };
        }
      }

      // Getter / setter.
      self.__defineGetter__(index, function() {
        return getter.call(self, obj[objIndex], properties);
      });
      self.__defineSetter__(index, function(value) {
        // Don't proceed if readOnly is true.
        if(properties.readOnly) {
          return;
        }

        // self[index] is used instead of obj[index] to route through the getter
        obj[objIndex] = setter.call(self, value, self[objIndex], properties);
      });

      // In case of object & array, they must be initialized immediately. However, this should not be done for aliases.
      if(properties.isAlias !== true) {
        if(properties.type === 'object') {
          obj[objIndex] = properties.objectType ? new properties.objectType : {};
        }
        else if(properties.type === 'array') {
          obj[objIndex] = properties.arrayProperties ? new SchemaArray(self, properties) : [];
        }
      }
    });

    // Return raw object.
    this.toObject = function() {
      var getObj = {};

      // Populate all properties in schema.
      _.each(schema, function(properties, index) {
        // Do not write values to object that are marked as writeOnly
        if(properties.invisible) {
          return;
        }

        // Fetch value from self[index] to route through getter.
        var value = self[index];

        // If value does not need to be cloned, place in index.
        if((value === undefined || value === null)
        || properties.type !== 'object' && properties.type !== 'array' && properties.type !== 'date') {
          getObj[index] = value;

        // Clone Object
        } else if(properties.type === 'object') {
          // Call toObject() method if defined (this allows us to return primitive objects instead of SchemaObjects).
          if(_.isFunction(value.toObject)) {
            getObj[index] = value.toObject();

          // If is non-SchemaType object, shallow clone so that properties modification don't have an affect on the original object.
          } else if(_.isObject(value)) {
            getObj[index] = _.clone(value);
          }

        // Clone Array
        } else if(properties.type === 'array') {
          // Create new Array to hold elements.
          getObj[index] = [];

          // Loop through each element, clone if necessary.
          _.each(value, function(element) {
            // Call toObject() method if defined (this allows us to return primitive objects instead of SchemaObjects).
            if(_.isObject(element) && _.isFunction(element.toObject)) {
              element = element.toObject();

            // If is non-SchemaType object, shallow clone so that properties modification don't have an affect on the original object.
            } else if(_.isObject(element)) {
              element = _.clone(element);
            }

            getObj[index].push(element);
          });

        // Clone Date object.
        } else if(properties.type === 'date') {
          // https://github.com/documentcloud/underscore/pull/863
          // _.clone doesn't work on Date object.
          getObj[index] = new Date(value.getTime());
        }
      });

      return getObj;
    }

    // Clear all values.
    this.clear = function() {
      self._obj = {};
    }

    // Populate runtime defaults as provided to this instance of object.
    // (Different than the default for each field - is simply a shortcut to populate values in object.)
    if(_.isObject(defaults)) {
      _.each(defaults, function(value, key) {
        self[key] = value;
      });
    };

    return self;
  }
}

module.exports = SchemaObject;