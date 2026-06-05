# Roadside Assistance App - Backend API

A comprehensive backend solution for a roadside assistance platform built with **Node.js**, **Express**, **MongoDB**, and **Socket.io** for real-time features.

## 🚀 Features

- **User Authentication** - Secure JWT-based authentication
- **Mechanic Management** - Profile, availability, and rating system
- **Service Requests** - Real-time service request management
- **Real-time Communication** - Socket.io for live chat and location tracking
- **Payment Integration** - Razorpay support
- **Notifications** - SMS (Twilio) and push notifications (Firebase)
- **Location-based Services** - Google Maps integration
- **Security** - CORS, rate limiting, XSS protection, sanitization

## 📋 Prerequisites

- **Node.js** >= 20.0.0
- **npm** >= 10.0.0
- **MongoDB** (local or Atlas)
- API Keys:
  - Google Maps API
  - Twilio (SMS)
  - Firebase (Push notifications)
  - Razorpay (Payments)

## 🛠️ Installation

### 1. Clone the repository
```bash
git clone https://github.com/pratyushsen655/roadside-assistance-app.git
cd roadside-assistance-app
```

### 2. Install dependencies
```bash
npm install
```

### 3. Create `.env` file
**On Windows PowerShell:**
```powershell
Copy-Item .env.example .env
```

**On Linux/Mac:**
```bash
cp .env.example .env
```

### 4. Configure environment variables
Edit `.env` and fill in your credentials:
```env
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/roadside_assistance
JWT_SECRET=your_super_secret_jwt_key
GOOGLE_MAPS_API_KEY=your_api_key
FIREBASE_PROJECT_ID=your_project_id
TWILIO_ACCOUNT_SID=your_account_sid
RAZORPAY_KEY_ID=your_key_id
RAZORPAY_KEY_SECRET=your_secret
```

### 5. Start MongoDB
```bash
mongod
```

## 🚀 Running the Application

### Development Mode
```bash
npm run dev
```
Server will run on `http://localhost:5000`

### Production Mode
```bash
npm start
```

### Run Tests
```bash
npm test
```

## 📁 Project Structure

```
roadside-assistance-app/
├── models/              # MongoDB schemas
│   ├── User.js
│   ├── Mechanic.js
│   ├── Request.js
│   ├── Payment.js
│   └── Chat.js
├── controllers/         # Business logic
├── routes/              # API endpoints
├── middleware/          # Express middleware
│   ├── authMiddleware.js
│   ├── errorMiddleware.js
│   ├── securityHeaders.js
│   ├── rateLimiter.js
│   └── apiKeyRotation.js
├── services/            # External integrations
├── sockets/             # Socket.io handlers
├── config/              # Configuration files
│   └── db.js
├── server.js            # Main server file
├── package.json
└── .env.example         # Environment template
```

## 🔌 API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/profile` - Get authenticated user profile

### Users
- `GET /api/users/profile` - Get user profile
- `PUT /api/users/profile` - Update user profile
- `GET /api/users/requests` - Get user's service requests

### Mechanics
- `GET /api/mechanics` - List available mechanics
- `GET /api/mechanics/:id` - Get mechanic details
- `PUT /api/mechanics/availability` - Update availability status

### Service Requests
- `POST /api/requests` - Create service request
- `GET /api/requests/:id` - Get request details
- `PUT /api/requests/:id` - Update request status

### Payments
- `POST /api/payments/create-order` - Create Razorpay order
- `POST /api/payments/verify` - Verify payment

### Chat
- `GET /api/chats/:requestId` - Get chat messages
- `POST /api/chats/:requestId/message` - Send message

## 🔌 Socket.io Events

### Client to Server
- `update-location` - Update mechanic's live location
- `send-message` - Send chat message
- `request-accepted` - Mechanic accepts service request
- `status-update` - Update request status

### Server to Client
- `location-updated` - Broadcast mechanic location
- `new-message` - Receive chat message
- `request-matched` - Notify user of matched mechanic
- `status-changed` - Notify status change

## 🐳 Docker Deployment

### Build Docker image
```bash
docker build -t roadside-app .
```

### Run container
```bash
docker run -p 5000:5000 --env-file .env roadside-app
```

## 🚀 Deployment Options

### Heroku
```bash
heroku create your-app-name
git push heroku main
```

### Railway
```bash
railway link
railway up
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## 📄 License

MIT License

---

**Made with ❤️ by the Roadside Assistance Team**
