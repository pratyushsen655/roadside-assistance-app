const ServiceRequest = require('../models/ServiceRequest');
const Rating = require('../models/Rating');
const PDFDocument = require('pdfkit');

const generateInvoice = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const job = await ServiceRequest.findById(jobId)
      .populate('customer', 'name phone')
      .populate('mechanic', 'name phone');

    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    const customer = /** @type {any} */ (job.customer);
    const mechanic = /** @type {any} */ (job.mechanic);

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=invoice_${jobId}.pdf`);
    doc.pipe(res);

    // Header
    doc.fontSize(24).fillColor('#B34700').text('Roadside Assistance', { align: 'center' });
    doc.fontSize(12).fillColor('#666').text('Professional Mechanic On Demand', { align: 'center' });
    doc.moveDown();
    doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#B34700').stroke();
    doc.moveDown();

    // Invoice details
    doc.fontSize(18).fillColor('#000').text('INVOICE', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#333');
    doc.text(`Invoice No: INV-${jobId.toString().slice(-6).toUpperCase()}`);
    doc.text(`Date: ${new Date(job.completedAt || job.createdAt).toLocaleDateString('en-IN')}`);
    doc.moveDown();

    // Customer & Mechanic details
    doc.fontSize(12).fillColor('#B34700').text('BILLED TO:');
    doc.fontSize(11).fillColor('#333');
    doc.text(`Name: ${customer?.name || 'Customer'}`);
    doc.text(`Phone: ${customer?.phone || '-'}`);
    doc.moveDown();

    doc.fontSize(12).fillColor('#B34700').text('SERVICE BY:');
    doc.fontSize(11).fillColor('#333');
    doc.text(`Mechanic: ${mechanic?.name || 'Mechanic'}`);
    doc.text(`Phone: ${mechanic?.phone || '-'}`);
    doc.moveDown();

    // Service details table
    doc.fontSize(12).fillColor('#B34700').text('SERVICE DETAILS:');
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#333');
    const serviceName = String(job.serviceType || 'breakdown').replace(/_/g, ' ').toUpperCase();
    doc.text(`Issue Type: ${serviceName}`);
    doc.text(`Vehicle: ${String(job.vehicleType || 'car').toUpperCase()} ${job.vehicleModel || ''} ${job.vehicleNumber ? '[' + job.vehicleNumber + ']' : ''}`);
    doc.text(`Service Date: ${new Date(job.createdAt).toLocaleDateString('en-IN')}`);
    doc.text(`Status: ${job.paymentStatus === 'paid' ? '✓ PAID' : 'PENDING'}`);
    doc.moveDown();

    // Amount breakdown
    doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#ddd').stroke();
    doc.moveDown(0.5);
    const serviceCharge = (job.pricing?.totalAmount || job.amount || 328) - 29;
    const platformFee = 29;
    const total = job.pricing?.totalAmount || job.amount || 328;
    
    doc.fontSize(11);
    doc.text('Service Charge:', 50, doc.y, { continued: true }).text(`\u20B9${serviceCharge}`, { align: 'right' });
    doc.text('Platform Fee:', 50, doc.y, { continued: true }).text(`\u20B9${platformFee}`, { align: 'right' });
    doc.moveTo(50, doc.y + 5).lineTo(550, doc.y + 5).strokeColor('#B34700').stroke();
    doc.moveDown();
    doc.fontSize(13).fillColor('#B34700').font('Helvetica-Bold');
    doc.text('TOTAL:', 50, doc.y, { continued: true }).text(`\u20B9${total}`, { align: 'right' });
    doc.moveDown(2);

    // Footer
    doc.fontSize(10).fillColor('#999').font('Helvetica');
    doc.text('Thank you for using Roadside Assistance!', { align: 'center' });
    doc.text('For support: support@roadside.com | +91 XXXXXXXXXX', { align: 'center' });

    doc.end();
  } catch (error) {
    next(error);
  }
};

const getHistory = async (req, res, next) => {
  try {
    const jobs = await ServiceRequest.find({ customer: req.user.id })
      .populate('mechanic', 'name rating averageRating')
      .sort({ createdAt: -1 });

    const jobIds = jobs.map(j => j._id);
    const ratings = await Rating.find({ jobId: { $in: jobIds } });
    const ratedJobIds = new Set(ratings.map(r => r.jobId.toString()));

    const history = jobs.map(job => {
      const mechanic = /** @type {any} */ (job.mechanic);
      return {
        id: job._id.toString(),
        serviceType: job.serviceType,
        vehicleMake: job.vehicleType ? (job.vehicleType.charAt(0).toUpperCase() + job.vehicleType.slice(1)) : 'Vehicle',
        vehicleModel: job.vehicleModel ? `${job.vehicleModel} [${job.vehicleNumber || 'N/A'}]` : (job.vehicleNumber || ''),
        mechanicName: mechanic?.name || 'Mechanic',
        mechanicRating: mechanic?.rating || mechanic?.averageRating || 5.0,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
        amount: job.pricing?.totalAmount || job.amount || 350,
        paymentStatus: job.paymentStatus,
        status: job.status,
        isInvoiceAvailable: job.status === 'completed' && job.paymentStatus === 'paid',
        isRated: ratedJobIds.has(job._id.toString())
      };
    });

    res.json({ success: true, history });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  generateInvoice,
  getHistory
};
