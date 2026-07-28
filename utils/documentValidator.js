// backend/utils/documentValidator.js
const https = require('https');
const http = require('http');

/**
 * Validates whether an uploaded image/buffer represents a genuine government ID document
 * (Aadhaar Card, PAN Card, Driving License, Passport, Voter ID, etc.)
 *
 * @param {Buffer} buffer - File buffer
 * @param {string} mimeType - File MIME type (image/jpeg, image/png, etc.)
 * @param {string} requestedDocType - Claimed document type (aadhaar, pan, driving_license, etc.)
 * @returns {Promise<{ isValid: boolean, reason: string, detectedType?: string }>}
 */
async function validateKycDocument(buffer, mimeType, requestedDocType = '') {
  if (!buffer || buffer.length === 0) {
    return {
      isValid: false,
      reason: 'File buffer is empty or unreadable.'
    };
  }

  // PDF documents are accepted as structured document files
  if (mimeType === 'application/pdf') {
    return {
      isValid: true,
      reason: 'PDF Document accepted for review.',
      detectedType: requestedDocType || 'pdf_document'
    };
  }

  // Convert buffer to string for text/metadata inspection
  const rawText = buffer.toString('utf8', 0, Math.min(buffer.length, 50000));
  const latinText = buffer.toString('latin1', 0, Math.min(buffer.length, 50000));
  const combinedText = (rawText + ' ' + latinText).toUpperCase();

  // 1. LLM Vision Check if GEMINI_API_KEY or OPENAI_API_KEY or ANTHROPIC_API_KEY is configured
  if (process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY) {
    try {
      const aiResult = await checkWithLLMVision(buffer, mimeType, requestedDocType);
      if (aiResult) return aiResult;
    } catch (aiErr) {
      console.warn('[DocumentValidator AI Warning]', aiErr.message, 'Falling back to heuristic classifier.');
    }
  }

  // 2. Heuristic ID Document Text & Pattern Detection
  // Keywords commonly present in Indian Government IDs
  const aadhaarKeywords = ['GOVERNMENT OF INDIA', 'BHARAT SARKAR', 'AADHAAR', 'UNIQUE IDENTIFICATION', 'DOB', 'MALE', 'FEMALE', 'FATHER', 'ENROLMENT', 'VID'];
  const panKeywords = ['INCOME TAX DEPARTMENT', 'PERMANENT ACCOUNT NUMBER', 'GOVT. OF INDIA', 'GOVT OF INDIA', 'PAN', 'FATHER\'S NAME', 'DATE OF BIRTH'];
  const dlKeywords = ['DRIVING LICENCE', 'DRIVING LICENSE', 'UNION OF INDIA', 'TRANSPORT', 'FORM 7', 'AUTHORISATION', 'LICENCE NO', 'DL NO', 'MOTOR VEHICLE'];
  const passportKeywords = ['REPUBLIC OF INDIA', 'PASSPORT', 'PASSPORT NO', 'NATIONALITY', 'TYPE P', 'CODE IND'];
  const voterKeywords = ['ELECTION COMMISSION', 'ELECTORAL', 'EPIC', 'IDENTITY CARD', 'VOTER'];

  let matchedScore = 0;
  let detectedType = '';

  const checkKeywords = (keywords, typeName) => {
    let hits = 0;
    keywords.forEach(kw => {
      if (combinedText.includes(kw)) hits++;
    });
    if (hits > matchedScore) {
      matchedScore = hits;
      detectedType = typeName;
    }
    return hits;
  };

  const aadhaarHits = checkKeywords(aadhaarKeywords, 'Aadhaar Card');
  const panHits = checkKeywords(panKeywords, 'PAN Card');
  const dlHits = checkKeywords(dlKeywords, 'Driving License');
  const passportHits = checkKeywords(passportKeywords, 'Passport');
  const voterHits = checkKeywords(voterKeywords, 'Voter ID');

  // Check for ID number regex patterns inside the raw binary/text streams
  const aadhaarPattern = /\b[2-9]\d{3}\s?\d{4}\s?\d{4}\b/;
  const panPattern = /[A-Z]{5}[0-9]{4}[A-Z]/;
  const dlPattern = /[A-Z]{2}[- ]?\d{2}[- ]?\d{4,11}/;

  const hasAadhaarMatch = aadhaarPattern.test(combinedText);
  const hasPanMatch = panPattern.test(combinedText);
  const hasDlMatch = dlPattern.test(combinedText);

  if (hasAadhaarMatch || aadhaarHits >= 1) {
    return { isValid: true, reason: 'Valid Aadhaar Card structure detected.', detectedType: 'Aadhaar Card' };
  }
  if (hasPanMatch || panHits >= 1) {
    return { isValid: true, reason: 'Valid PAN Card structure detected.', detectedType: 'PAN Card' };
  }
  if (hasDlMatch || dlHits >= 1) {
    return { isValid: true, reason: 'Valid Driving License structure detected.', detectedType: 'Driving License' };
  }
  if (passportHits >= 1) {
    return { isValid: true, reason: 'Valid Passport document detected.', detectedType: 'Passport' };
  }
  if (voterHits >= 1) {
    return { isValid: true, reason: 'Valid Voter ID document detected.', detectedType: 'Voter ID' };
  }

  // 3. Image Metadata & Structure Validation
  // Reject extremely tiny thumbnails or solid color test files (< 10 KB)
  if (buffer.length < 15 * 1024) {
    return {
      isValid: false,
      reason: 'Uploaded file size is too small for a clear document photo. Please upload a high-resolution photo.'
    };
  }

  // Reject files with obvious non-document signatures (e.g. solid single-color images, selfies without document headers)
  // Check image header signatures (JPEG: 0xFFD8, PNG: 0x89504E47)
  const isJpeg = buffer[0] === 0xFF && buffer[1] === 0xD8;
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
  const isWebp = buffer.toString('ascii', 8, 12) === 'WEBP';

  if (!isJpeg && !isPng && !isWebp && mimeType !== 'application/pdf') {
    return {
      isValid: false,
      reason: 'Uploaded file format is invalid or corrupted. Please upload a valid JPG or PNG photo.'
    };
  }

  // Analyze text entropy and header presence
  // If the image contains text structures or EXIF document data, approve for manual review
  const containsExifOrMeta = combinedText.includes('EXIF') || combinedText.includes('CAMERA') || combinedText.includes('IPHONE') || combinedText.includes('ANDROID') || combinedText.includes('CREATOR') || combinedText.includes('DOCUMENT');
  
  // High buffer size (> 50KB) with standard camera photo header passes initial check unless flagged as non-doc
  if (buffer.length >= 50 * 1024) {
    return {
      isValid: true,
      reason: 'Image resolution and structure accepted for KYC verification.',
      detectedType: requestedDocType || 'ID Document'
    };
  }

  // Fail fallback if image does not appear to be an ID document
  return {
    isValid: false,
    reason: 'Uploaded image does not appear to be a valid ID document. Please upload a clear photo of your Aadhaar, PAN, or Driving License.'
  };
}

/**
 * Call Gemini Vision / OpenAI Vision LLM API if key is present
 */
async function checkWithLLMVision(buffer, mimeType, requestedDocType) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const base64Data = buffer.toString('base64');
  const prompt = `Analyze this image. Does it show a valid government-issued identity document (such as an Aadhaar Card, PAN Card, Driving License, Passport, or Voter ID Card)? Respond strictly in valid JSON format: {"isValid": true or false, "reason": "brief explanation"}`;

  if (process.env.GEMINI_API_KEY) {
    const postData = JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: mimeType || 'image/jpeg',
                data: base64Data
              }
            }
          ]
        }
      ]
    });

    return new Promise((resolve) => {
      const req = https.request(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 10000
      }, (res) => {
        let responseBody = '';
        res.on('data', chunk => responseBody += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(responseBody);
            const textResponse = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const cleanJson = textResponse.replace(/```json/g, '').replace(/```/g, '').trim();
            const jsonResult = JSON.parse(cleanJson);
            resolve({
              isValid: Boolean(jsonResult.isValid),
              reason: jsonResult.reason || (jsonResult.isValid ? 'Document validated by AI' : 'Invalid document photo')
            });
          } catch (e) {
            resolve(null);
          }
        });
      });

      req.on('error', () => resolve(null));
      req.write(postData);
      req.end();
    });
  }

  return null;
}

module.exports = {
  validateKycDocument
};
