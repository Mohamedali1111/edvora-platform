import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { AuthModule } from '../auth/auth.module';
import { DeviceModule } from '../devices/device.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { InstructorCourseController } from './http/instructor-course.controller';
import { InstructorLessonController } from './http/instructor-lesson.controller';
import { InstructorSectionController } from './http/instructor-section.controller';
import { StudentCourseController } from './http/student-course.controller';
import { CourseProgressService } from './services/course-progress.service';
import { CourseReadinessService } from './services/course-readiness.service';
import { CourseSectionService } from './services/course-section.service';
import { CourseService } from './services/course.service';
import { LessonService } from './services/lesson.service';
import { StudentCourseAccessService } from './services/student-course-access.service';

@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    DeviceModule,
    TenancyModule,
    ThrottlerModule.forRoot([
      {
        name: 'course',
        ttl: 60_000,
        limit: 60,
      },
    ]),
  ],
  controllers: [
    InstructorCourseController,
    InstructorSectionController,
    InstructorLessonController,
    StudentCourseController,
  ],
  providers: [
    CourseService,
    CourseSectionService,
    LessonService,
    StudentCourseAccessService,
    CourseProgressService,
    CourseReadinessService,
  ],
  exports: [CourseService, CourseSectionService, LessonService, StudentCourseAccessService],
})
export class CoursesModule {}
