# SmartDocQ - AI-Powered Document Intelligence Platform

In today's information-driven world, efficiently extracting insights from documents is crucial for academic success and professional productivity. The growing volume of digital documents presents challenges in comprehension, knowledge retention, and information retrieval. SmartDocQ is an intelligent document processing platform that leverages advanced AI technology to transform how users interact with their documents.

## Overview

SmartDocQ is a comprehensive full-stack web application that enables users to upload documents, engage with content through natural language queries, and generate educational resources automatically. By combining Retrieval-Augmented Generation (RAG) with Google's Gemini AI, the platform delivers accurate, context-aware responses while maintaining document privacy and security.

## Features

### Core Functionality
- **Document Upload & Processing**: Support for PDF, DOCX, and TXT files with intelligent text extraction and preprocessing
- **AI-Powered Chat**: Interactive question-answering system that provides context-aware responses based on uploaded documents
- **Quiz Generation**: Automatic creation of multiple-choice, true/false, and short-answer questions from document content
- **Flashcard Creation**: Smart extraction of key concepts and definitions for effective learning and revision
- **Text Summarization**: Concise summaries of document content for quick comprehension

### Security & Privacy
- **Sensitive Data Detection**: Automatic identification of personal information (emails, phone numbers, Aadhaar, PAN, credit cards, SSN)
- **User Consent Workflow**: Privacy-first approach requiring explicit consent before processing sensitive documents
- **Content Moderation**: Profanity filtering and URL validation to maintain platform integrity
- **JWT Authentication**: Secure user sessions with role-based access control (User, Admin, Moderator)

### Administrative Tools
- **User Management**: Comprehensive admin dashboard for user oversight and role assignment
- **Document Analytics**: Track document uploads, processing status, and usage statistics
- **Report Management**: Handle user feedback and support inquiries efficiently
- **System Monitoring**: Real-time logs and performance metrics

## Technology Stack

### Frontend
- **React.js 18.x**: Modern component-based UI framework
- **React Router DOM**: Client-side routing and navigation
- **i18next**: Internationalization support
- **GSAP & Lottie**: Smooth animations and interactive elements
- **Focus Trap React**: Accessibility features

### Backend Middleware
- **Node.js & Express 5.x**: RESTful API server
- **Mongoose 8.x**: MongoDB object modeling
- **JWT & bcryptjs**: Authentication and password security
- **Multer**: File upload handling
- **CORS**: Cross-origin resource sharing configuration

### AI Service
- **Flask 3.x**: Python web framework for AI processing
- **Google Gemini 2.5 Flash**: Advanced text generation and comprehension
- **Text-Embedding-004**: High-quality vector embeddings
- **ChromaDB 0.5+**: Vector database for semantic search

### Document Processing
- **PyPDF2**: PDF text extraction
- **python-docx**: Microsoft Word document processing
- **Better Profanity**: Content filtering

### Database
- **MongoDB Atlas**: Primary NoSQL database for user data, documents, and chat history
- **ChromaDB**: Vector store for document embeddings and semantic retrieval

## Architecture

SmartDocQ follows a **three-tier microservice architecture**:

1. **Presentation Layer**: React.js frontend providing responsive user interface
2. **Business Logic Layer**: Node.js/Express middleware handling authentication, routing, and database operations
3. **AI Processing Layer**: Flask service managing document processing, embeddings, and AI interactions

This separation ensures scalability, maintainability, and efficient resource utilization.

## Requirements

To set up SmartDocQ locally, you'll need:

- **Node.js**: Version 20.x or higher
- **Python**: Version 3.9 or higher
- **MongoDB**: Local installation or MongoDB Atlas account
- **Google AI API Key**: For Gemini AI access
- **Git**: Version control
- Basic understanding of web development and REST APIs

## Local Setup Instructions

### 1. Fork & Clone Repository

```bash
# Fork the repository on GitHub, then clone your fork
git clone https://github.com/your-username/SmartDocQ.git
cd SmartDocQ
```

### 2. Backend Middleware Setup

```bash
# Navigate to servers directory
cd servers

# Install dependencies
npm install

# Create .env file with the following variables:
# MONGODB_URI=your_mongodb_connection_string
# JWT_SECRET=your_jwt_secret_key
# FLASK_SERVICE_URL=http://localhost:5000
# FLASK_SERVICE_TOKEN=your_service_token
# PORT=4000

# Start the server
npm start
```

### 3. AI Service Setup

```bash
# Navigate to backend directory
cd ../backend

# Create virtual environment (recommended)
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Create .env file with:
# GEMINI_API_KEY=your_google_ai_api_key
# SERVICE_TOKEN=your_service_token
# MONGODB_URI=your_mongodb_connection_string

# Start Flask service
python main.py
```

### 4. Frontend Setup

```bash
# Navigate to my-app directory
cd ../my-app

# Install dependencies
npm install

# Create .env file with:
# REACT_APP_API_URL=http://localhost:4000

# Start development server
npm start
```

### 5. Access the Application

Open your browser and navigate to:
```
http://localhost:3000
```

The application will be running with:
- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:4000`
- Flask AI Service: `http://localhost:5000`

## Usage Guide

1. **Register/Login**: Create an account or sign in to access the platform
2. **Upload Document**: Navigate to the upload page and select your document (PDF, DOCX, or TXT)
3. **Consent Review**: If sensitive data is detected, review and provide consent
4. **Chat**: Ask questions about your document and receive AI-powered answers
5. **Generate Quiz**: Create practice questions to test your understanding
6. **Create Flashcards**: Generate study cards for key concepts
7. **Summarize**: Get concise summaries of document sections
8. **Share**: Share chat conversations with others via unique links

## API Documentation

### Authentication Endpoints
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `GET /api/auth/me` - Get current user profile

### Document Endpoints
- `POST /api/documents/upload` - Upload document
- `GET /api/documents` - List user documents
- `DELETE /api/documents/:id` - Delete document

### Chat Endpoints
- `POST /api/chat/message` - Send message and get AI response
- `GET /api/chat/history/:documentId` - Retrieve chat history
- `POST /api/chat/rate` - Rate AI response quality

### Admin Endpoints
- `GET /api/admin/users` - List all users
- `PUT /api/admin/users/:id/role` - Update user role
- `GET /api/admin/stats` - System statistics

## Contributing

We welcome contributions from the community! Here's how you can help:

1. **Fork the Repository**: Click the "Fork" button at the top of this page
2. **Create Feature Branch**: `git checkout -b feature/your-feature-name`
3. **Make Changes**: Implement your feature or bug fix
4. **Test Thoroughly**: Ensure all existing tests pass and add new tests if needed
5. **Commit Changes**: `git commit -m "Add meaningful commit message"`
6. **Push to Branch**: `git push origin feature/your-feature-name`
7. **Submit Pull Request**: Open a PR with a clear description of your changes

### Contribution Guidelines

- Follow existing code style and conventions
- Write clear, descriptive commit messages
- Update documentation for any API or feature changes
- Add unit tests for new functionality
- Ensure no sensitive data or API keys are committed

## Testing

```bash
# Run backend tests
cd servers
npm test

# Run frontend tests
cd my-app
npm test

# Run Python tests
cd backend
pytest
```

## Deployment

SmartDocQ can be deployed on various platforms:

- **Frontend**: Vercel, Netlify, or AWS Amplify
- **Backend**: Heroku, Railway, or AWS EC2
- **AI Service**: Heroku, Render, or Google Cloud Run
- **Database**: MongoDB Atlas (recommended)

Refer to `DEPLOYMENT_CHECKLIST.md` for detailed deployment instructions.

## Security Considerations

- All passwords are hashed using bcrypt
- JWT tokens expire after 24 hours
- Sensitive data detection runs before document processing
- Content moderation filters inappropriate content
- CORS configured for specific allowed origins
- Environment variables store sensitive configuration

## Future Enhancements

- **Multilingual Support**: Document processing and AI responses in multiple languages
- **Advanced Analytics**: Detailed insights on document usage and learning patterns
- **Collaborative Features**: Shared workspaces and team document libraries
- **Mobile Application**: Native iOS and Android apps
- **Integration APIs**: Connect with learning management systems (LMS)
- **Voice Interaction**: Voice-based queries and responses
- **Offline Mode**: Local document processing without internet

## Acknowledgments

Special thanks to:
- Google AI team for Gemini API access
- The open-source community for excellent libraries and frameworks
- Contributors who have helped improve this project

## Contact & Support

For questions, issues, or feature requests:
- **Issues**: [GitHub Issues](https://github.com/SmartDocQ/SmartDocQ/issues)
- **Email**: smartdocq@gmail.com

## Contributors

Thanks to all the contributors who have helped build SmartDocQ:

<!-- ALL-CONTRIBUTORS-LIST:START -->
<!-- Add your contributor badges here -->
<!-- ALL-CONTRIBUTORS-LIST:END -->

---

