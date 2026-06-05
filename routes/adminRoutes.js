const express = require('express');

const router = express.Router();

router.get('/dashboard', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Admin dashboard',
  });
});

module.exports = router;
