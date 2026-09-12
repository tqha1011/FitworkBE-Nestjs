export type JobItemResponseDto = {
  publicId: string;
  title: string;
  description: string;
  location: string;
  budget: number;
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
