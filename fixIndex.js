require('dotenv').config();
const mongoose = require('mongoose');

async function fixIndex() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to:', mongoose.connection.db.databaseName);

  const collection = mongoose.connection.db.collection('pricingconfigs');
  const indexes = await collection.indexes();
  console.log('Current indexes:', JSON.stringify(indexes, null, 2));

  const oldIndex = indexes.find(idx => idx.key && idx.key.serviceType === 1 && !idx.key.vehicleType);
  if (oldIndex) {
    await collection.dropIndex(oldIndex.name);
    console.log('Dropped old index:', oldIndex.name);
  } else {
    console.log('No old single-field serviceType index found.');
  }

  await mongoose.disconnect();
  console.log('Done.');
}

fixIndex().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});