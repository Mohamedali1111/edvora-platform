import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { AuthModule } from '../auth/auth.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { InstructorCourseController } from './http/instructor-course.controller';
import { CourseService } from './services/course.service';

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
  controllers: [InstructorCourseController],
  providers: [CourseService],
  exports: [CourseService],
})
export class CoursesModule {}
