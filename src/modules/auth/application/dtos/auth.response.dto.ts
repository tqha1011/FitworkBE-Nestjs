export type RegisterResponseDto = {
  publicId: string;
};

export type LoginResponseDto = {
  accessToken: string;
  expiresIn: number;
};
