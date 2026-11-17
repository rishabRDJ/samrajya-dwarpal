import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RefreshToken } from './refresh-token.entity.js';
import { TokenService } from './token.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([RefreshToken]),
    // JwtModule is registered empty here; TokenService passes secret and
    // expiresIn per signing call so they can come from ConfigService without
    // a circular bootstrap dependency.
    JwtModule.register({}),
  ],
  providers: [TokenService],
  exports: [TokenService],
})
export class AuthModule {}
