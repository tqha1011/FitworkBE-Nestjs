export type ResumeResponseDto = {
  publicId: string;
};

export type ResumeUploadResponseDto = {
  uploadUrl: string;
  storageKey: string;
  expiresAt: Date;
};
