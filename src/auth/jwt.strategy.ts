import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserRole } from '../users/user.entity.js';
import type { JwtPayload } from './token.service.js';

export interface AuthenticatedUser {
  id: string;
  role: UserRole;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      // Reads the token from `Authorization: Bearer <token>`. Any other
      // transport (query string, cookie) would need a different extractor.
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      // Enforce the `exp` claim written at sign time by TokenService.
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  // Passport calls validate() only after the signature and exp have been
  // verified. Whatever this returns becomes `req.user` on the request object.
  // Keeping the user object tiny keeps the JWT small and avoids a DB hit.
  validate(payload: JwtPayload): AuthenticatedUser {
    return { id: payload.sub, role: payload.role };
  }
}
