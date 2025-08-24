const { newScrap } = require('./scrapperv3.cjs')
const { connectDB } = require('../models/mongo.cjs')
require('./demonicScansScraper')
connectDB();
newScrap();
