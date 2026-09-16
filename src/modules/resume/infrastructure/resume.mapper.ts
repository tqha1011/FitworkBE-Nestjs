import { CommonFileType } from 'src/shared/domain/enum';
import { FileType } from 'generated/prisma/enums';

export const fileTypeToPrisma: Record<CommonFileType, FileType> = {
  [CommonFileType.PDF]: FileType.PDF,
  [CommonFileType.DOCX]: FileType.DOCX,
};

export const prismaToFileType: Record<FileType, CommonFileType> = {
  [FileType.PDF]: CommonFileType.PDF,
  [FileType.DOCX]: CommonFileType.DOCX,
};

export function toPrismaFileType(fileType: CommonFileType): FileType {
  return fileTypeToPrisma[fileType];
}

export function toCommonFileType(fileType: FileType): CommonFileType {
  return prismaToFileType[fileType];
}
