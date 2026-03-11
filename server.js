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

app.listen(PORT, () => {
    console.log(`🚀 Bhutta Fragness Backend running at http://localhost:${PORT}`);
    console.log(`Configure your .env file to enable email notifications.`);
});
