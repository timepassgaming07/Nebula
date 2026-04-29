const Joi = require('joi');

function validate(schema) {
  return (req, res, next) => {
    const { error } = schema.validate(req.body, { abortEarly: false });
    if (error) {
      const errors = error.details.map((d) => d.message);
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }
    next();
  };
}

const schemas = {
  updateProfile: Joi.object({
    displayName: Joi.string().min(2).max(20).pattern(/^[a-zA-Z0-9_\- ]+$/),
    avatarId: Joi.number().integer().min(1).max(50),
  }),
};

module.exports = { validate, schemas };
