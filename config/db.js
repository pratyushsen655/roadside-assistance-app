const mongoose = require('mongoose');

const connectDB = async () => {
  const maxAttempts = 5;
  let attempt = 0;
  while (attempt < maxAttempts) {
    try {
      const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/roadside_assistance', {
        autoIndex: true,
      });
      console.log(`[Database] MongoDB Connected: ${conn.connection.host} (attempt ${attempt + 1})`);
      return;
    } catch (error) {
      attempt++;
      console.error(`[Database] Connection attempt ${attempt} failed: ${error.message}`);
      if (attempt >= maxAttempts) {
        console.error('[Database] Maximum retry attempts reached. Exiting.');
        process.exit(1);
      }
      // exponential backoff
      await new Promise(res => setTimeout(res, 2000 * attempt));
    }
  }
};

module.exports = connectDB;
