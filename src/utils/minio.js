import * as Minio from 'minio'

let minioClient

const getClient = () => {
  if (!minioClient) {
    minioClient = new Minio.Client({
      endPoint: process.env.MINIO_ENDPOINT,
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY,
      secretKey: process.env.MINIO_SECRET_KEY,
    })
  }
  return minioClient
}

const DEFAULT_EXPIRY_SECONDS = 24 * 60 * 60

const getPresignedUrl = async (fileName, expirySeconds = DEFAULT_EXPIRY_SECONDS) =>
  getClient().presignedGetObject(
    process.env.MINIO_BUCKET,
    `${process.env.MINIO_PREFIX}/${fileName}`,
    expirySeconds
  )

export { getClient, getPresignedUrl }
