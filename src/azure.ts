import * as core from "@actions/core";
import * as azure from "@azure/storage-blob";
import { mkdir } from "fs";
import path, * as Path from "path";
import { resolveContentType } from "./contenttype";
import * as files from "./files";

export class Blob {}

export class AzureBlobStorage {
  static async create(connectionString: string, containerName: string): Promise<AzureBlobStorage> {
    const blobServiceClient = azure.BlobServiceClient.fromConnectionString(connectionString);
    const containerClient = blobServiceClient.getContainerClient(containerName);

    if (!(await containerClient.exists())) {
      throw new Error(`The container ${containerName} does not exist.`);
    }

    return new AzureBlobStorage(containerClient);
  }

  constructor(private containerClient: azure.ContainerClient) {}

  async uploadFiles(rootPath: string): Promise<number> {
    const i = [0];
    await files.walkFiles(rootPath, async (filePath: string) => {
      await this.uploadFile(rootPath, filePath);
      ++i[0];
    });

    return i[0];
  }

  async downloadFiles(destPath: string): Promise<number> {
    const i: number[] = [0];

    await this.walkBlobs(async blob => {
      const destFilePath = path.join(destPath, blob.name);
      await this.downloadFile(blob.name, destFilePath);
      ++i[0];
    });

    return i[0];
  }

  async walkBlobs(
    callback: (blob: azure.BlobItem) => Promise<void>,
    options: azure.ContainerListBlobsOptions = {},
  ): Promise<void> {
    for await (const response of this.containerClient.listBlobsFlat(options).byPage({ maxPageSize: 50 })) {
      for (const blob of response.segment.blobItems) {
        await callback(blob);
      }
    }
  }

  async uploadFile(rootPath: string, filePath: string, contentTypeHeaders: azure.BlobHTTPHeaders = {}): Promise<void> {
    core.info(`Uploading ${filePath}...`);
    const relativePath = Path.relative(rootPath, filePath);
    const blobName = relativePath.replace(/\\/g, "/");

    if (!contentTypeHeaders.blobContentType) {
      contentTypeHeaders.blobContentType = resolveContentType(relativePath) || undefined;
    }

    const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.uploadFile(filePath, { blobHTTPHeaders: contentTypeHeaders });
  }

  async downloadFile(srcBlobPath: string, destFilePath: string): Promise<void> {
    core.info(`Downloading ${srcBlobPath}...`);
    await mkdir(path.dirname(destFilePath), { recursive: true }, () => {/* empty */});
    const blockBlobClient = this.containerClient.getBlockBlobClient(srcBlobPath);
    await blockBlobClient.downloadToFile(destFilePath);
  }
}
