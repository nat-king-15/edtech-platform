const { firestore } = require('../config/firebase');
const admin = require('firebase-admin');

class ContentService {
  constructor() {
    this.db = firestore;
  }

  /**
   * Fetch user-purchased batches
   * Similar to pw-extractor's fetch_batches function
   */
  async fetchUserBatches(userId, page = 1, limit = 20) {
    try {
      const offset = (page - 1) * limit;
      
      // Get user enrollments
      const enrollmentsSnapshot = await this.db.collection('enrollments')
        .where('studentId', '==', userId)
        .where('status', '==', 'active')
        .limit(limit)
        .offset(offset)
        .get();

      if (enrollmentsSnapshot.empty) {
        return {
          success: true,
          batches: [],
          message: 'No enrolled batches found'
        };
      }

      const batches = [];
      for (const enrollmentDoc of enrollmentsSnapshot.docs) {
        const enrollmentData = enrollmentDoc.data();
        
        // Get batch details
        const batchDoc = await this.db.collection('batches').doc(enrollmentData.batchId).get();
        if (batchDoc.exists) {
          const batchData = batchDoc.data();
          batches.push({
            name: batchData.title,
            slug: batchData.slug || batchDoc.id,
            _id: batchDoc.id,
            startDate: batchData.startDate,
            endDate: batchData.endDate,
            expiryDate: batchData.expiryDate || batchData.endDate,
            status: batchData.status,
            courseId: batchData.courseId,
            courseName: batchData.courseName,
            enrolledAt: enrollmentData.enrolledAt
          });
        }
      }

      return {
        success: true,
        batches: batches
      };
    } catch (error) {
      console.error('Error fetching user batches:', error);
      return {
        success: false,
        error_message: error.message,
        error_status: 500
      };
    }
  }

  /**
   * Fetch all subjects for a given batch
   * Similar to pw-extractor's fetch_subjects function
   */
  async fetchBatchSubjects(batchId) {
    try {
      const subjectsSnapshot = await this.db.collection('subjects')
        .where('batchId', '==', batchId)
        .orderBy('displayOrder', 'asc')
        .get();

      if (subjectsSnapshot.empty) {
        return {
          success: true,
          subjects: [],
          message: 'No subjects found for this batch'
        };
      }

      const subjects = [];
      for (const subjectDoc of subjectsSnapshot.docs) {
        const subjectData = subjectDoc.data();
        
        // Get teacher details
        const teacherIds = subjectData.teacherIds || [];
        const teachers = [];
        
        for (const teacherId of teacherIds) {
          const teacherDoc = await this.db.collection('users').doc(teacherId).get();
          if (teacherDoc.exists) {
            const teacherData = teacherDoc.data();
            teachers.push({
              firstName: teacherData.displayName?.split(' ')[0] || '',
              lastName: teacherData.displayName?.split(' ').slice(1).join(' ') || '',
              experience: teacherData.teacherData?.experience || '',
              qualification: teacherData.teacherData?.qualification || '',
              email: teacherData.email
            });
          }
        }

        // Count chapters/topics
        const chaptersSnapshot = await this.db.collection('chapters')
          .where('subjectId', '==', subjectDoc.id)
          .get();

        subjects.push({
          _id: subjectDoc.id,
          subject: subjectData.name,
          slug: subjectData.slug || subjectDoc.id,
          teacherIds: teachers,
          tagCount: subjectData.tagCount || 0,
          displayOrder: subjectData.displayOrder || 0,
          lectureCount: chaptersSnapshot.size,
          description: subjectData.description || ''
        });
      }

      return {
        success: true,
        subjects: subjects
      };
    } catch (error) {
      console.error('Error fetching batch subjects:', error);
      return {
        success: false,
        error_message: error.message,
        error_status: 500
      };
    }
  }

  /**
   * Fetch topics/chapters for a subject
   * Similar to pw-extractor's fetch_topics function
   */
  async fetchSubjectTopics(subjectId, page = 1, limit = 50) {
    try {
      const offset = (page - 1) * limit;
      
      const chaptersSnapshot = await this.db.collection('chapters')
        .where('subjectId', '==', subjectId)
        .orderBy('displayOrder', 'asc')
        .limit(limit)
        .offset(offset)
        .get();

      if (chaptersSnapshot.empty) {
        return {
          success: true,
          topics: [],
          message: 'No chapters found for this subject'
        };
      }

      const topics = [];
      for (const chapterDoc of chaptersSnapshot.docs) {
        const chapterData = chapterDoc.data();
        
        // Count different content types
        const [notesCount, exercisesCount, videosCount] = await Promise.all([
          this.countContentByType(chapterDoc.id, 'notes'),
          this.countContentByType(chapterDoc.id, 'exercises'),
          this.countContentByType(chapterDoc.id, 'videos')
        ]);

        topics.push({
          _id: chapterDoc.id,
          name: chapterData.title,
          displayOrder: chapterData.displayOrder || 0,
          notes: notesCount,
          exercises: exercisesCount,
          videos: videosCount,
          lectureVideos: videosCount, // Same as videos for compatibility
          slug: chapterData.slug || chapterDoc.id,
          description: chapterData.description || '',
          isPublished: chapterData.isPublished || false
        });
      }

      return {
        success: true,
        topics: topics
      };
    } catch (error) {
      console.error('Error fetching subject topics:', error);
      return {
        success: false,
        error_message: error.message,
        error_status: 500
      };
    }
  }

  /**
   * Fetch notes/attachments for a given topic
   * Similar to pw-extractor's fetch_notes function
   */
  async fetchTopicNotes(chapterId, page = 1, limit = 20) {
    try {
      const offset = (page - 1) * limit;
      
      const notesSnapshot = await this.db.collection('content')
        .where('chapterId', '==', chapterId)
        .where('type', '==', 'notes')
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .offset(offset)
        .get();

      const notesList = [];
      for (const noteDoc of notesSnapshot.docs) {
        const noteData = noteDoc.data();
        
        // Get chapter name
        const chapterDoc = await this.db.collection('chapters').doc(chapterId).get();
        const chapterName = chapterDoc.exists ? chapterDoc.data().title : 'Unknown Chapter';

        const attachments = [];
        if (noteData.attachments && Array.isArray(noteData.attachments)) {
          noteData.attachments.forEach(att => {
            attachments.push({
              _id: att.id || noteDoc.id,
              baseUrl: att.baseUrl || '',
              key: att.key || att.path || '',
              name: att.name || att.filename || 'Untitled'
            });
          });
        }

        notesList.push({
          topic: chapterName,
          attachments: attachments,
          createdAt: noteData.createdAt,
          updatedAt: noteData.updatedAt
        });
      }

      return {
        success: true,
        notes: notesList
      };
    } catch (error) {
      console.error('Error fetching topic notes:', error);
      return {
        success: false,
        error_message: error.message,
        error_status: 500
      };
    }
  }

  /**
   * Fetch DPP (Daily Practice Problems) for a given topic
   * Similar to pw-extractor's fetch_dpp function
   */
  async fetchTopicDPP(chapterId, page = 1, limit = 20) {
    try {
      const offset = (page - 1) * limit;
      
      const dppSnapshot = await this.db.collection('content')
        .where('chapterId', '==', chapterId)
        .where('type', '==', 'dpp')
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .offset(offset)
        .get();

      const dppList = [];
      for (const dppDoc of dppSnapshot.docs) {
        const dppData = dppDoc.data();
        
        // Get chapter name
        const chapterDoc = await this.db.collection('chapters').doc(chapterId).get();
        const chapterName = chapterDoc.exists ? chapterDoc.data().title : 'Unknown Chapter';

        const attachments = [];
        if (dppData.attachments && Array.isArray(dppData.attachments)) {
          dppData.attachments.forEach(att => {
            attachments.push({
              _id: att.id || dppDoc.id,
              baseUrl: att.baseUrl || '',
              key: att.key || att.path || '',
              name: att.name || att.filename || 'Untitled DPP'
            });
          });
        }

        dppList.push({
          topic: chapterName,
          attachments: attachments,
          createdAt: dppData.createdAt,
          updatedAt: dppData.updatedAt,
          difficulty: dppData.difficulty || 'medium'
        });
      }

      return {
        success: true,
        dpp: dppList
      };
    } catch (error) {
      console.error('Error fetching topic DPP:', error);
      return {
        success: false,
        error_message: error.message,
        error_status: 500
      };
    }
  }

  /**
   * Get quiz attempt ID for a topic
   * Similar to pw-extractor's get_dpp_quiz_attempt_id function
   */
  async getQuizAttemptId(userId, chapterId, quizType = 'dpp') {
    try {
      const attemptSnapshot = await this.db.collection('quiz_attempts')
        .where('userId', '==', userId)
        .where('chapterId', '==', chapterId)
        .where('type', '==', quizType)
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();

      if (attemptSnapshot.empty) {
        return {
          success: true,
          attemptId: null,
          message: 'No quiz attempts found'
        };
      }

      const attemptDoc = attemptSnapshot.docs[0];
      return {
        success: true,
        attemptId: attemptDoc.id
      };
    } catch (error) {
      console.error('Error getting quiz attempt ID:', error);
      return {
        success: false,
        error_message: error.message,
        error_status: 500
      };
    }
  }

  /**
   * Fetch quiz questions for an attempt
   * Similar to pw-extractor's fetch_dpp_quiz_questions function
   */
  async fetchQuizQuestions(attemptId) {
    try {
      const attemptDoc = await this.db.collection('quiz_attempts').doc(attemptId).get();
      
      if (!attemptDoc.exists) {
        return {
          success: false,
          error_message: 'Quiz attempt not found',
          error_status: 404
        };
      }

      const attemptData = attemptDoc.data();
      const quizId = attemptData.quizId;

      // Get quiz questions
      const questionsSnapshot = await this.db.collection('quiz_questions')
        .where('quizId', '==', quizId)
        .orderBy('questionNumber', 'asc')
        .get();

      const questions = [];
      questionsSnapshot.docs.forEach(questionDoc => {
        const questionData = questionDoc.data();
        
        // Format options
        const options = [];
        if (questionData.options && Array.isArray(questionData.options)) {
          questionData.options.forEach((option, index) => {
            options.push({
              _id: option.id || `option_${index}`,
              en: option.text || option.content || ''
            });
          });
        }

        // Format images
        const images = [];
        if (questionData.images && Array.isArray(questionData.images)) {
          questionData.images.forEach(img => {
            images.push({
              _id: img.id || questionDoc.id,
              name: img.name || 'Question Image',
              baseUrl: img.baseUrl || '',
              key: img.key || img.path || ''
            });
          });
        }

        // Format solution descriptions
        const solutionDescriptions = [];
        if (questionData.solutionImages && Array.isArray(questionData.solutionImages)) {
          questionData.solutionImages.forEach(img => {
            solutionDescriptions.push({
              _id: img.id || `${questionDoc.id}_solution`,
              name: img.name || 'Solution Image',
              baseUrl: img.baseUrl || '',
              key: img.key || img.path || ''
            });
          });
        }

        questions.push({
          _id: questionDoc.id,
          questionNumber: questionData.questionNumber || 0,
          images: images,
          options: options,
          solution_option_ids: questionData.correctOptions || [],
          difficultyLevel: questionData.difficulty || 'medium',
          topicName: questionData.topicName || '',
          solutionDescriptions: solutionDescriptions
        });
      });

      return {
        success: true,
        questions: questions
      };
    } catch (error) {
      console.error('Error fetching quiz questions:', error);
      return {
        success: false,
        error_message: error.message,
        error_status: 500
      };
    }
  }

  /**
   * Helper function to count content by type
   */
  async countContentByType(chapterId, contentType) {
    try {
      const snapshot = await this.db.collection('content')
        .where('chapterId', '==', chapterId)
        .where('type', '==', contentType)
        .get();
      
      return snapshot.size;
    } catch (error) {
      console.error(`Error counting ${contentType}:`, error);
      return 0;
    }
  }

  /**
   * Search content across batches and subjects
   */
  async searchContent(userId, query, contentType = 'all', limit = 20) {
    try {
      // Get user's enrolled batches first
      const userBatches = await this.fetchUserBatches(userId, 1, 100);
      if (!userBatches.success || userBatches.batches.length === 0) {
        return {
          success: true,
          results: [],
          message: 'No enrolled batches found'
        };
      }

      const batchIds = userBatches.batches.map(batch => batch._id);
      const results = [];

      // Search in different collections based on content type
      if (contentType === 'all' || contentType === 'chapters') {
        const chaptersSnapshot = await this.db.collection('chapters')
          .where('batchId', 'in', batchIds.slice(0, 10)) // Firestore 'in' limit
          .get();

        chaptersSnapshot.docs.forEach(doc => {
          const data = doc.data();
          if (data.title?.toLowerCase().includes(query.toLowerCase()) ||
              data.description?.toLowerCase().includes(query.toLowerCase())) {
            results.push({
              type: 'chapter',
              id: doc.id,
              title: data.title,
              description: data.description,
              subjectId: data.subjectId,
              batchId: data.batchId
            });
          }
        });
      }

      return {
        success: true,
        results: results.slice(0, limit)
      };
    } catch (error) {
      console.error('Error searching content:', error);
      return {
        success: false,
        error_message: error.message,
        error_status: 500
      };
    }
  }
}

module.exports = new ContentService();