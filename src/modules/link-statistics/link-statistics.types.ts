export type AccessEventInput = {
  eventId: string;
  linkId: string;
  occurredAt: Date;
  occurredOn: string;
  country: string;
  visitorPseudonym: string;
};

export type StatisticsPeriod = {
  from: string;
  to: string;
};

export type LinkStatisticsDailyPoint = {
  date: string;
  accesses: number;
  dailyUniqueVisitors: number;
};

export type LinkStatisticsMonthlyPoint = {
  month: string;
  accesses: number;
  dailyUniqueVisitors: number;
};

export type LinkStatisticsCountryPoint = {
  country: string;
  accesses: number;
  dailyUniqueVisitors: number;
};

export type LinkStatisticsReport = {
  linkId: string;
  period: {
    from: string;
    to: string;
    timezone: 'UTC';
  };
  totals: {
    accesses: number;
    dailyUniqueVisitors: number;
  };
  daily: LinkStatisticsDailyPoint[];
  monthly: LinkStatisticsMonthlyPoint[];
  countries: LinkStatisticsCountryPoint[];
};
