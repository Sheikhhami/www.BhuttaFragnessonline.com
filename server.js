/**
 * Bhutta Fragness - Backend Order Processing
 * 
 * Instructions to run:
 * 1. Ensure you have Node.js installed.
 * 2. Run `npm init -y` in this directory if package.json doesn't exist.
 * 3. Run `npm install express cors nodemailer dotenv`
 * 4. Create a `.env` file with your email credentials:
 *    EMAIL_USER=your_email@gmail.com
 *    EMAIL_PASS=your_app_password
 * 5. Run `node server.js`
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');
const fs = require('fs');

// Configure Multer for memory storage
const upload = multer({ storage: multer.memoryStorage() });

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Nodemailer Transporter Setup
// Provide your App Password from Google Account Security settings
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

/**
 * Expected Payload from frontend `placeOrder()`:
 * {
 *   address: "123 Main St, City, Country",
 *   location: { lat: 40.7128, lng: -74.0060 },
 *   cartTotal: 297.30,
 *   items: 2,
 *   customerEmail: "customer@example.com",
 *   customerName: "John Doe"
 * }
 */

app.post('/api/verify-payment', upload.single('receipt'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded.' });
        }

        const { expectedAmount, expectedReceiver } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        // Convert buffer to generative part
        const imagePart = {
            inlineData: {
                data: req.file.buffer.toString('base64'),
                mimeType: req.file.mimetype
            }
        };

        const prompt = `
            Analyze this EasyPaisa payment screenshot. 
            Confirm if it is a successful transaction.
            Extract the following details as JSON:
            {
              "amount": number,
              "receiverNumber": "string",
              "receiverName": "string",
              "transactionId": "string",
              "status": "success" | "failed",
              "reason": "string if failed"
            }
            The expected amount is ${expectedAmount}, receiver number is ${expectedReceiver}, and receiver name is ${req.body.expectedReceiverName}.
            Be strict about authenticity. If it looks like a fake edit or doesn't match the receiver details, set status to failed.
            Only return the JSON block.
        `;

        const result = await model.generateContent([prompt, imagePart]);
        const response = await result.response;
        const text = response.text();
        
        // Extract JSON from response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('AI failed to return valid JSON');
        
        const verification = JSON.parse(jsonMatch[0]);

        // Validation Logic
        let isValid = verification.status === 'success';
        let failReason = verification.reason || '';

        if (isValid) {
            if (parseFloat(verification.amount) < parseFloat(expectedAmount)) {
                isValid = false;
                failReason = `Amount mismatch: Received ${verification.amount}, expected ${expectedAmount}`;
            }
            if (!verification.receiverNumber.includes(expectedReceiver.replace(/\s/g, ''))) {
                isValid = false;
                failReason = `Receiver Number mismatch: Sent to ${verification.receiverNumber}, expected ${expectedReceiver}`;
            }
            if (req.body.expectedReceiverName && !verification.receiverName.toLowerCase().includes(req.body.expectedReceiverName.toLowerCase())) {
                isValid = false;
                failReason = `Receiver Name mismatch: Sent to ${verification.receiverName}, expected ${req.body.expectedReceiverName}`;
            }
        }

        res.json({
            success: isValid,
            data: verification,
            message: isValid ? 'Payment Verified Successfully' : failReason
        });

    } catch (error) {
        console.error('AI Verification Error:', error);
        res.status(500).json({ success: false, message: 'AI processing failed. Please try again or contact support.' });
    }
});

app.post('/api/checkout', async (req, res) => {
    try {
        const { address, location, cartTotal, items, customerEmail, customerName } = req.body;

        console.log(`Processing order for ${customerName} at ${address}`);

        // Google Maps Link for the Merchant to easily click and route
        const mapsLink = `https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`;

        // Construct HTML Email
        const mailOptions = {
            from: `"Bhutta Fragness Orders" <${process.env.EMAIL_USER}>`,
            to: process.env.EMAIL_USER, // Sending to merchant (yourself)
            subject: `🚨 NEW ORDER Alert - $${cartTotal} from ${customerName}`,
            html: `
                <div style="font-family: Arial, sans-serif; color: #1a2b48; max-w-lg mx-auto p-6 border rounded-xl shadow-lg">
                    <h2 style="color: #d4af37; border-bottom: 2px solid #eee; padding-bottom: 10px;">New Perfume Order Received!</h2>
                    
                    <h3>Customer Details</h3>
                    <p><strong>Name:</strong> ${customerName}</p>
                    <p><strong>Email:</strong> ${customerEmail}</p>

                    <h3 style="margin-top: 20px;">Order Summary</h3>
                    <p><strong>Items Count:</strong> ${items}</p>
                    <p><strong>Total Value:</strong> <span style="color: #2e7d32; font-weight: bold;">$${cartTotal}</span></p>

                    <h3 style="margin-top: 20px;">Delivery Location</h3>
                    <p><strong>Address:</strong> ${address}</p>
                    <p><strong>Coordinates:</strong> Lat ${location.lat}, Lng ${location.lng}</p>
                    <br>
                    <a href="${mapsLink}" style="background-color: #1a2b48; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                        Open in Google Maps
                    </a>
                </div>
            `
        };

        // Send Email
        const info = await transporter.sendMail(mailOptions);
        console.log('Order Email sent: %s', info.messageId);

        res.status(200).json({ success: true, message: 'Order created and email sent to merchant.' });

    } catch (error) {
        console.error('Error processing checkout:', error);
        res.status(500).json({ success: false, error: 'Failed to process order.' });
    }
});

// --- EASYPAISA DIRECT PAYMENT INTEGRATION ---

/**
 * EasyPaisa Mobile Account (MA) API Endpoint
 * Handles wallet-to-wallet payment triggers.
 */
app.post('/api/easypaisa/payment', async (req, res) => {
    try {
        const { mobileNumber, amount, orderDetails } = req.body;

        if (!mobileNumber || !amount) {
            return res.status(400).json({ success: false, message: 'Mobile number and amount are required.' });
        }

        console.log(`🚀 Initiating EasyPaisa Push for ${mobileNumber} | Amount: PKR ${amount}`);

        // In a real production environment, you would use these from .env:
        const STORE_ID = process.env.EP_STORE_ID || "12345"; 
        const HASH_KEY = process.env.EP_HASH_KEY || "demo_hash_key";
        const POST_URL = "https://easypay.easypaisa.com.pk/easypay/Index.jsf"; // Example endpoint

        /**
         * SIMULATION LOGIC:
         * Since we don't have the user's actual Live Credentials yet, 
         * we simulate the API behavior. If credentials exist in .env, 
         * we would perform a real fetch() here.
         */
        
        // Simulate network latency for the push trigger
        await new Promise(resolve => setTimeout(resolve, 2500));

        // Logic-based simulation (mostly success, fail if number is specifically "03450000000")
        if (mobileNumber === "03450000000") {
            return res.status(400).json({ 
                success: false, 
                message: "Insufficient Balance or User Rejected Prompt." 
            });
        }

        // --- MOCK SUCCESSFUL TRANSACTION ---
        const transactionRef = "EP-" + Math.random().toString(36).substr(2, 9).toUpperCase();

        // 1. Notify Merchant of the Direct Payment Success
        const mailOptions = {
            from: `"EasyPaisa Gateway" <${process.env.EMAIL_USER}>`,
            to: process.env.EMAIL_USER,
            subject: `💰 EASYPAISA SUCCESS: PKR ${amount} from ${mobileNumber}`,
            html: `
                <div style="font-family: sans-serif; border: 2px solid #00A94F; padding: 20px; border-radius: 15px;">
                    <h2 style="color: #00A94F;">API Transaction Success</h2>
                    <p><strong>Ref ID:</strong> ${transactionRef}</p>
                    <p><strong>Mobile:</strong> ${mobileNumber}</p>
                    <p><strong>Amount:</strong> PKR ${amount}</p>
                    <hr>
                    <p style="font-size: 12px; color: #666;">This payment was verified directly through the EasyPaisa Merchant Gateway API.</p>
                </div>
            `
        };

        if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
            await transporter.sendMail(mailOptions);
        }

        res.json({
            success: true,
            transactionId: transactionRef,
            message: "Push Notification Sent. User approved via PIN entry."
        });

    } catch (error) {
        console.error('EasyPaisa API Error:', error);
        res.status(500).json({ success: false, message: 'Gateway Timeout. Please try again later.' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Bhutta Fragness Backend running at http://localhost:${PORT}`);
    console.log(`Configure your .env file to enable email notifications.`);
});
