const dotenv = require('dotenv');
dotenv.config();

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhone = process.env.TWILIO_PHONE_NUMBER;

let twilioClient = null;

if (accountSid && authToken) {
  try {
    // Lazy load twilio to prevent crashes if credentials are blank or invalid
    const twilio = require('twilio');
    twilioClient = twilio(accountSid, authToken);
    console.log('[SMS Service] Twilio Client initialized successfully.');
  } catch (error) {
    console.warn('[SMS Service] Failed to initialize Twilio client:', error.message);
  }
} else {
  console.log('[SMS Service] Twilio credentials missing. Running in mock/console mode.');
}

/**
 * Send an OTP to a phone number.
 * @param {string} phone
 * @param {string} otp
 */
const sendOTP = async (phone, otp) => {
  const messageBody = `Your Roadside Assistance OTP is: ${otp}. Valid for 10 minutes.`;

  if (twilioClient && twilioPhone) {
    try {
      await twilioClient.messages.create({
        body: messageBody,
        from: twilioPhone,
        to: phone
      });
      console.log(`[SMS Service] Actual SMS OTP sent to ${phone}`);
      return true;
    } catch (error) {
      console.error(`[SMS Service] Twilio failed sending SMS to ${phone}:`, error.message);
      // Fallback to mock logging on failure
    }
  }

  // Fallback / Development Mock
  console.log('\n==================================================');
  console.log(`[MOCK SMS SERVICE] SMS Sent to: ${phone}`);
  console.log(`[MOCK SMS SERVICE] Message: ${messageBody}`);
  console.log('==================================================\n');
  return true;
};

module.exports = {
  sendOTP
};
