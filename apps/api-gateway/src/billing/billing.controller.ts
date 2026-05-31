import { Body, Controller, Get, Logger, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, type JwtUser } from '@slack/common';
import { BillingService } from './billing.service';
import { CreateCheckoutDto } from './dto/checkout.dto';

@Controller('billing')
@ApiTags('Billing')
@ApiBearerAuth()
export class BillingController {
  private readonly logger = new Logger(BillingController.name);

  constructor(private readonly billingService: BillingService) {}

  @Get('plans')
  @ApiOperation({ summary: 'Get all available subscription plans' })
  @ApiResponse({ status: 200, description: 'List of active plans' })
  getPlans() {
    return this.billingService.getPlans();
  }

  @Post('checkout')
  @ApiOperation({ summary: 'Create a Stripe checkout session for a plan' })
  @ApiResponse({ status: 201, description: 'Returns checkoutUrl to redirect the user to Stripe' })
  createCheckout(
    @Body() dto: CreateCheckoutDto,
    @CurrentUser() user: JwtUser,
  ) {
    this.logger.log(`User ${user.sub} initiating checkout for plan ${dto.planId}`);
    return this.billingService.createCheckout(user.sub, dto.planId);
  }

  @Post('customer-portal')
  @ApiOperation({ summary: 'Create a Stripe Customer Portal session' })
  @ApiResponse({ status: 201, description: 'Returns portalUrl to redirect the user to the Stripe portal' })
  createPortal(@CurrentUser() user: JwtUser) {
    this.logger.log(`User ${user.sub} opening customer portal`);
    return this.billingService.createPortal(user.sub);
  }

  @Get('my-subscription')
  @ApiOperation({ summary: 'Get the current subscription of the authenticated user' })
  @ApiResponse({ status: 200, description: 'Subscription details including plan info' })
  getMySubscription(@CurrentUser() user: JwtUser) {
    return this.billingService.getMySubscription(user.sub);
  }
}
