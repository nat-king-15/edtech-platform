## 1. Project Structure Standards

### Frontend Structure (Next.js/React)
### Backend Structure (Node.js/Express)# EdTech Platform - Project Rules

## 2. Coding Standards

### File Naming Conventions
- **Components**: PascalCase (e.g., `UserProfile.tsx`)
- **Pages**: kebab-case (e.g., `user-dashboard.tsx`)
- **Utilities**: camelCase (e.g., `formatDate.js`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `API_ENDPOINTS.js`)

### Code Organization
- One component per file
- Export default for main component
- Named exports for utilities
- Group imports: external libraries → internal modules → relative imports

### TypeScript Standards
- Use TypeScript for all new code
- Define interfaces for all data structures
- Use strict type checking
- Avoid `any` type unless absolutely necessary

## 3. Technology Stack Guidelines

### Frontend Stack
- **Framework**: Next.js 14+ with App Router
- **Styling**: Tailwind CSS
- **State Management**: React Context + useReducer or Zustand
- **Forms**: React Hook Form with Zod validation
- **HTTP Client**: Axios or Fetch API
- **UI Components**: Custom components with Tailwind

### Backend Stack
- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: Firebase Firestore
- **Authentication**: Firebase Auth + JWT
- **File Storage**: Firebase Storage + Mux (for videos)
- **Payment**: Razorpay
- **Email**: Nodemailer

### Development Tools
- **Package Manager**: npm
- **Code Formatting**: Prettier
- **Linting**: ESLint
- **Version Control**: Git with conventional commits

## 4. Development Workflow

### Git Workflow
- **Branch Naming**: `feature/feature-name`, `fix/bug-description`, `hotfix/critical-fix`
- **Commit Messages**: Follow conventional commits format
  - `feat: add user authentication`
  - `fix: resolve login modal styling issue`
  - `docs: update API documentation`

### Code Review Process
- All code must be reviewed before merging
- Ensure tests pass before review
- Check for security vulnerabilities
- Verify performance implications

### Testing Strategy
- **Unit Tests**: Jest for utilities and services
- **Integration Tests**: API endpoint testing
- **E2E Tests**: Playwright for critical user flows
- **Manual Testing**: UI/UX validation

## 5. Architecture Principles

### Frontend Architecture
- **Component Composition**: Build complex UIs from simple components
- **State Management**: Keep state as close to where it's used as possible
- **Performance**: Implement lazy loading and code splitting
- **Accessibility**: Follow WCAG 2.1 guidelines

### Backend Architecture
- **RESTful APIs**: Follow REST conventions
- **Error Handling**: Consistent error response format
- **Validation**: Input validation on all endpoints
- **Security**: Implement rate limiting and input sanitization

### Database Design
- **Collections**: Users, Courses, Batches, Enrollments, Payments
- **Relationships**: Use subcollections and references appropriately
- **Indexing**: Create indexes for frequently queried fields
- **Security Rules**: Implement proper Firestore security rules

## 6. API Design Standards

### Endpoint Naming

### Response Format
```json
{
  "success": true,
  "data": {},
  "message": "Operation successful",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### Error Response Format
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": []
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

## 7. Security Guidelines

### Authentication & Authorization
- Use Firebase Auth for user management
- Implement JWT tokens for API authentication
- Role-based access control (Student, Teacher, Admin)
- Session management and token refresh

### Data Protection
- Validate all user inputs
- Sanitize data before database operations
- Use HTTPS for all communications
- Implement rate limiting on APIs

### File Upload Security
- Validate file types and sizes
- Scan uploaded files for malware
- Use secure file storage with proper permissions

## 8. Performance Guidelines

### Frontend Performance
- Implement lazy loading for routes and components
- Optimize images with Next.js Image component
- Use React.memo for expensive components
- Implement proper caching strategies

### Backend Performance
- Use database indexing for frequent queries
- Implement caching for static data
- Optimize API response sizes
- Use connection pooling for database

## 9. Documentation Standards

### Code Documentation
- Write JSDoc comments for all functions
- Document complex business logic
- Maintain README files for each module
- Keep API documentation up to date

### Project Documentation
- Architecture decisions and rationale
- Setup and deployment instructions
- Troubleshooting guides
- User guides for different roles

## 10. Quality Assurance

### Code Quality
- Maintain test coverage above 80%
- Use static code analysis tools
- Regular code reviews and refactoring
- Performance monitoring and optimization

### User Experience
- Responsive design for all devices
- Consistent UI/UX across the platform
- Accessibility compliance
- Fast loading times and smooth interactions

## 11. Deployment & DevOps

### Environment Management
- **Development**: Local development environment
- **Staging**: Pre-production testing environment
- **Production**: Live production environment

### Deployment Process
- Automated testing before deployment
- Database migration scripts
- Environment-specific configuration
- Rollback procedures for failed deployments

### Monitoring & Logging
- Application performance monitoring
- Error tracking and alerting
- User analytics and behavior tracking
- System health monitoring

---

**Note**: These rules should be followed by trae ai ide and updated as the project evolves. Regular reviews and updates ensure the project maintains high quality and consistency.