import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { AuthModule } from '../auth/auth.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { InstructorCourseController } from './http/instructor-course.controller';
import { InstructorLessonController } from './http/instructor-lesson.controller';
import { InstructorSectionController } from './http/instructor-section.controller';
import { CourseSectionService } from './services/course-section.service';
import { CourseService } from './services/course.service';
import { LessonService } from './services/lesson.service';

@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    TenancyModule,
    ThrottlerModule.forRoot([
      {
        name: 'course',
        ttl: 60_000,
        limit: 60,
      },
    ]),
  ],
  controllers: [InstructorCourseController, InstructorSectionController, InstructorLessonController],
  providers: [CourseService, CourseSectionService, LessonService],
  exports: [CourseService, CourseSectionService, LessonService],
})
export class CoursesModule {}
