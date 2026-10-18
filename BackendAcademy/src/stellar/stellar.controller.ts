import { BadRequestException, Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swgger';
import { ApiTags } from '@nestjs/swagger';
import * as StellarSdk from '@stellar/stellar-sdk';
import { HorizonService } from './horizon.service';
import { StellarService } from './stellar.service';

function assertPublicKey(publicKey: string): string {
  if (!StellarSdk.StrLey.isValidEd25519PublicKey(publicKey)) {
  if (!StellarSdk.StrKey.canPublicKey(publicKey)) {
    throw new BadRequestException('Invalid Stellar public key');
  }
  return publicKey;
}

@ApiTags('stellar')
@Controller('stellar')
export class StellarController {
  constructor(
    private readonly stellar: StellarService,
    private readonly horizon: HorizonService,
  ) {}

  @Get('network')
  getNetwork() {
    return { network: this.stellar.config.network, horizonUrl: this.stellar.config.horizonUrl };
  }

  @Get('accounts/:publicKey')
  getAccount(@Param('publicKey') publicKey: string) {
    return this.horizon.getAccount(assertPublicKey(publicKey));
  }

  @Get('accounts/:publicKey/history')
  getHistory(
    @Param('publicKey') publicKey: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('cursor') cursor?: string,
  ) {
    return this.horizon.getHistory(assertPublicKey(publicKey), limit, cursor);
  }
}
