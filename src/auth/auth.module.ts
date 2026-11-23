import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtStrategy } from './jwt.strategy.js';
import { RefreshToken } from './refresh-token.entity.js';
import { TokenService } from './token.service.js';
import { UserPasswordController } from './user-password.controller.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([RefreshToken]),
    PassportModule,
    JwtModule.register({}),
    UsersModule,
  ],
  controllers: [AuthController, UserPasswordController],
  providers: [TokenService, JwtStrategy, AuthService],
  // Export AuthService so a future admin module (PR C Step 5+) can call
  // changePassword() without rewiring auth internals.
  exports: [TokenService, AuthService],
})
export class AuthModule {}
