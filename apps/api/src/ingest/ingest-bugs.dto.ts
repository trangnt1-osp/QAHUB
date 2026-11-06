import { ATTACHMENT_KINDS, AttachmentKind, MAX_ATTACHMENT_BYTES, PRIORITIES, Priority } from '@ospm/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, Equals, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

const trim = () => Transform(({ value }) => typeof value === 'string' ? value.trim() : value);

export class BugAttachmentDto {
  @ApiProperty() @trim() @IsString() @MinLength(1) @MaxLength(200) ref: string;
  @ApiProperty({ enum: ATTACHMENT_KINDS }) @IsIn([...ATTACHMENT_KINDS]) kind: AttachmentKind;
  @ApiProperty() @trim() @IsString() @MinLength(1) @MaxLength(255) fileName: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) mimeType: string;
  @ApiProperty({ maximum: MAX_ATTACHMENT_BYTES }) @IsInt() @Min(0) @Max(MAX_ATTACHMENT_BYTES) size: number;
}

export class IngestBugDto {
  @ApiProperty({ description: 'Stable Bug ID in the external repository, unique within the QA Hub project.' })
  @trim() @IsString() @MinLength(1) @MaxLength(200) externalId: string;
  @ApiProperty({ enum: [true], description: 'The submitting QC has already confirmed this is a product Bug.' })
  @Equals(true) confirmed: true;
  @ApiProperty() @trim() @IsString() @MinLength(1) @MaxLength(255) title: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayNotEmpty() @ArrayMaxSize(100)
  @Transform(({ value }) => Array.isArray(value) ? value.map((step) => typeof step === 'string' ? step.trim() : step) : value)
  @IsString({ each: true }) @MinLength(1, { each: true }) @MaxLength(4000, { each: true }) steps: string[];
  @ApiProperty() @trim() @IsString() @MinLength(1) @MaxLength(20000) expected: string;
  @ApiProperty() @trim() @IsString() @MinLength(1) @MaxLength(20000) actual: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20000) preconditions?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20000) description?: string;
  @ApiPropertyOptional({ enum: PRIORITIES }) @IsOptional() @IsIn([...PRIORITIES]) priority?: Priority;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) assigneeId?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) environment?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) branch?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) commitSha?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(100)
  @IsString({ each: true }) @MinLength(1, { each: true }) @MaxLength(200, { each: true }) testCaseIds?: string[];
  @ApiPropertyOptional({ type: [BugAttachmentDto] }) @IsOptional() @IsArray() @ArrayMaxSize(20)
  @ArrayUnique((a: BugAttachmentDto) => a?.ref) @ValidateNested({ each: true }) @Type(() => BugAttachmentDto) attachments?: BugAttachmentDto[];
}

export class IngestBugsDto {
  @ApiProperty({ type: [IngestBugDto], minItems: 1, maxItems: 100 })
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(100) @ArrayUnique((bug: IngestBugDto) => bug?.externalId)
  @ValidateNested({ each: true }) @Type(() => IngestBugDto) bugs: IngestBugDto[];
}
