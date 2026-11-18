import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtStrategy } from './jwt.strategy.js';
import { RefreshToken } from './refresh-token.entity.js';
import { TokenService } from './token.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([RefreshToken]),
    PassportModule,
    JwtModule.register({}),
  ],
  providers: [TokenService, JwtStrategy],
  exports: [TokenService],
})
export class AuthModule {}
