import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';

// Guards the /internal/* routes. Diwan calls with `x-system-key: <hex>`;
// we compare byte-for-byte against SYSTEM_API_KEY in constant time.
//
// Why timingSafeEqual and not ===: a byte-wise compare that short-circuits
// on the first mismatch leaks how many leading bytes matched. Measured over
// many requests an attacker can brute-force one byte at a time.
// timingSafeEqual takes the same number of cycles whether byte 0 or byte 63
// differs. It also requires both buffers to be the same length — we reject
// a wrong-length key before the compare so a short guess can never crash
// the server.
@Injectable()
export class SystemAuthGuard implements CanActivate {
  private readonly expected: Buffer;

  constructor(config: ConfigService) {
    this.expected = Buffer.from(
      config.getOrThrow<string>('SYSTEM_API_KEY'),
      'hex',
    );
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();

    const raw = req.headers['x-system-key'];
    const hex = typeof raw === 'string' ? raw : '';

    // Fail fast on malformed input — timingSafeEqual throws on size mismatch.
    if (!/^[0-9a-fA-F]+$/.test(hex)) throw new UnauthorizedException();
    const presented = Buffer.from(hex, 'hex');
    if (presented.length !== this.expected.length) {
      throw new UnauthorizedException();
    }

    if (!timingSafeEqual(presented, this.expected)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
