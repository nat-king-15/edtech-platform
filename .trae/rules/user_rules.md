# User-Specific Development Rules

## Full-Stack Integration Requirements

### 1. Backend-Frontend Integration
- **Mandatory Connection**: All future implementations must have complete backend and frontend integration
- **Database Connectivity**: Every feature must have proper database connection and data flow implementation
- **API Integration**: Frontend components must be properly connected with backend APIs
- **Real Data Flow**: Use actual database data instead of mock data for fetch and update operations

### 2. Implementation Standards
- **Complete Structure**: Backend routes, middleware, services, and frontend components must all be properly structured
- **Authentication Flow**: User authentication system must be properly implemented in frontend with backend JWT tokens
- **Error Handling**: Backend errors must be properly handled in frontend
- **State Management**: Frontend must have proper state management synchronized with backend data

### 3. Database Integration Rules
- **Firestore Connection**: All CRUD operations must be properly connected with Firestore database
- **Real-time Updates**: Implement real-time data updates where necessary
- **Data Validation**: Both backend data validation and frontend form validation must be implemented
- **Security**: Database operations must have proper security rules and authentication checks

### 4. Feature Development Approach
- **End-to-End**: Every feature must be implemented completely end-to-end (frontend UI + backend API + database)
- **Testing**: Proper testing must be done after implementation to ensure data flow works correctly
- **Documentation**: API endpoints and usage must be documented for every feature

### 5. Code Quality Standards
- **Consistent Architecture**: Must follow existing project architecture patterns
- **Error Boundaries**: Proper error boundaries in frontend and comprehensive error handling in backend
- **Performance**: Database queries must be optimized and frontend must have proper loading states
- **Security**: All API endpoints must have proper authentication and authorization checks

### 6. Development Workflow
- **Backend First**: Backend API endpoints must be created first, then frontend integration
- **Database Schema**: Proper database schema must be designed first
- **API Testing**: Backend APIs must be tested first before frontend integration
- **Full Integration**: Complete end-to-end testing must be done at the end

These rules ensure that every implementation is complete, functional, and properly integrated.