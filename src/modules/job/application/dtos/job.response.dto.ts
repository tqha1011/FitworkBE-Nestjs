import { CommonCurrency, CommonJobStatus } from 'src/shared/domain/enum';

export type JobItemResponseDto = {
  publicId: string;
  title: string;
  description: string;
  location: string;
  budget: number;
  currency: CommonCurrency;
  skills: {
    id: number;
    name: string;
  }[];
  category: {
    id: number;
    name: string;
  };
  arrangement: {
    id: number;
    name: string;
  };
  dueAt: Date;
  totalApplicants: number;
};

export type JobDetailResponseDto = {
  publicId: string;
  title: string;
  description: string;
  location: string;
  requirements: string;
  budget: number;
  currency: CommonCurrency;
  status: CommonJobStatus;
  skills: {
    id: number;
    name: string;
  }[];
  category: {
    id: number;
    name: string;
  };
  arrangement: {
    id: number;
    name: string;
  };
  postedBy: {
    publicId: string;
    name: string;
    participatedSince: Date;
  };
  dueAt: Date;
  totalApplicants: number;
};
