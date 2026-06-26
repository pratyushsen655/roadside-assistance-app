// eslint-disable-next-line @typescript-eslint/no-var-requires
/** @type {import('axios').AxiosStatic} */
const axios = /** @type {any} */ (require('axios'));

const sendOTP = async (phone, otp) => {
  const url = 'https://control.msg91.com/api/v5/otp';
  const response = await axios.post(url, {
    template_id: process.env.MSG91_TEMPLATE_ID,
    mobile: phone, // format: 919140906912
    authkey: process.env.MSG91_AUTH_KEY,
    otp: otp,
    sender: process.env.MSG91_SENDER_ID || 'RDASST'
  }, {
    headers: { 'Content-Type': 'application/json' }
  });
  return response.data;
};

const retryOTP = async (phone) => {
  const url = 'https://control.msg91.com/api/v5/otp/retry';
  const response = await axios.post(url, {
    mobile: phone,
    authkey: process.env.MSG91_AUTH_KEY,
    retrytype: 'text'
  }, {
    headers: { 'Content-Type': 'application/json' }
  });
  return response.data;
};

const verifyOTPviaMSG91 = async (phone, otp) => {
  const url = `https://control.msg91.com/api/v5/otp/verify?mobile=${phone}&otp=${otp}&authkey=${process.env.MSG91_AUTH_KEY}`;
  const response = await axios.get(url);
  return response.data;
};

module.exports = { sendOTP, retryOTP, verifyOTPviaMSG91 };
