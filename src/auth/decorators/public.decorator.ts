import { SetMetadata } from '@nestjs/common';

// Metadata key the JwtAuthGuard reads to decide whether to skip authentication.
// Exported so the guard can import the exact same symbol without a magic string.
export const IS_PUBLIC_KEY = 'isPublic';

// Attach to a controller or handler to opt out of the global JwtAuthGuard.
// Example: @Public() @Post('login') login(...) {}
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
