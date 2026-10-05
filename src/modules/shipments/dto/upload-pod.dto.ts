import { IsOptional, IsString } from 'class-validator';

// `photo`/`signature` are files, handled via @UploadedFiles() — not part of this DTO.
export class UploadPodDto {
  @IsOptional()
  @IsString()
  notes?: string;
}
