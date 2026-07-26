import { Controller, Get } from '@nestjs/common';

@Controller('api')
export class ApiInfoController {
  @Get()
  getApiInfo() {
    return {
      name: 'RustAcademy API',
      version: process.env.npm_package_version || '1.0.0',
      status: 'ok',
      docs: '/api/docs',
      features: {
        ai: {
          recommendations: true,
          explainability: true,
          modelVersion: 'rustacademy-recommender-v2',
        },
        payments: {
          coupons: true,
          redemptionHistory: true,
        },
      },
    };
  }
}
