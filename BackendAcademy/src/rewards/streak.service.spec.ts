import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { StreakService } from './streak.service';

describe('StreakService', () => {
  let service: StreakService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StreakService],
    }).compile();

    service = module.get<StreakService>(StreakService);
  });

  // Clear all data before each test
  beforeEach(() => {
    service.clearAll();
  });

  // -------------------------------------------------------------------------
  // getStreak() tests
  // -------------------------------------------------------------------------

  describe('getStreak()', () => {
    const USER = 'test-user-abc';

    it('throws NotFoundException for unknown user', () => {
      expect(() => service.getStreak(USER)).toThrow(NotFoundException);
    });

    it('returns zero streak for a user after reset', () => {
      // Register the user first (getStreak throws for truly unknown users)
      service.checkIn(USER);
      service.resetStreak(USER);
      const streak = service.getStreak(USER);
      expect(streak).toMatchObject({
        userId: USER,
        currentStreak: 0,
        longestStreak: 0,
        lastCheckin: null,
        nextCheckinAvailable: expect.any(String),
        isStreakAlive: false,
      });
    });
  });

  // -------------------------------------------------------------------------
  // checkIn() tests
  // -------------------------------------------------------------------------

  describe('checkIn()', () => {
    const USER = 'test-user-abc';

    it('allows first check-in', () => {
      const result = service.checkIn(USER);
      expect(result).toMatchObject({
        userId: USER,
        xpAwarded: 10, // BASE_CHECKIN_XP
        newStreak: 1,
        longestStreak: 1,
        streakBonus: 0,
      });
      expect(result.message).toContain('Welcome');
    });

    it('prevents double check-in same day', () => {
      service.checkIn(USER);
      expect(() => service.checkIn(USER)).toThrow(
        /already checked in today/,
      );
    });

    it('continues streak on consecutive days', () => {
      // Day 1
      service.checkIn(USER);

      // Manually set lastCheckin to yesterday so checkIn sees a consecutive day
      const record = service.getRecord(USER)!;
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      record.lastCheckin = yesterday;

      const result = service.checkIn(USER);
      expect(result.newStreak).toBe(2);
      // streak bonus only kicks in at 3-day streak (STREAK_BONUS_THRESHOLDS)
      expect(result.streakBonus).toBe(0);
    });

    it('resets streak after missing a day', () => {
      // Day 1
      service.checkIn(USER);

      // Manually set lastCheckin to 2 days ago so streak breaks
      const record = service.getRecord(USER)!;
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      record.lastCheckin = twoDaysAgo;

      const result = service.checkIn(USER);
      expect(result.newStreak).toBe(1); // Reset to 1
      expect(result.message).toContain('Streak reset');
    });
  });

  // -------------------------------------------------------------------------
  // resetStreak() tests
  // -------------------------------------------------------------------------

  describe('resetStreak()', () => {
    const USER = 'test-user-abc';

    it('resets user streak to zero', () => {
      // Build up a streak
      service.checkIn(USER);
      
      // Verify streak is active
      let streak = service.getStreak(USER);
      expect(streak.currentStreak).toBe(1);
      
      // Reset
      service.resetStreak(USER);
      
      // Verify reset
      streak = service.getStreak(USER);
      expect(streak.currentStreak).toBe(0);
      expect(streak.longestStreak).toBe(0);
      expect(streak.lastCheckin).toBeNull();
    });
  });
});