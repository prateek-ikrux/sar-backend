import * as Minio from 'minio'
import {
  RESUME_URL_EXPIRY_SECONDS,
  RESUME_EXISTS_TTL_MS,
  RESUME_MISSING_TTL_MS,
  RESUME_CACHE_MAX_ENTRIES,
} from '../constants.js'

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

const existenceCache = new Map()

const readCache = (fileName) => {
  const entry = existenceCache.get(fileName)
  if (!entry) return undefined
  if (entry.expiresAt <= Date.now()) {
    existenceCache.delete(fileName)
    return undefined
  }
  return entry.exists
}

const writeCache = (fileName, exists) => {
  if (existenceCache.size >= RESUME_CACHE_MAX_ENTRIES) {
    existenceCache.delete(existenceCache.keys().next().value)
  }
  existenceCache.set(fileName, {
    exists,
    expiresAt: Date.now() + (exists ? RESUME_EXISTS_TTL_MS : RESUME_MISSING_TTL_MS),
  })
}

const objectKey = (fileName) => `${process.env.MINIO_PREFIX}/${fileName}`

const getPresignedUrl = async (fileName, expirySeconds = RESUME_URL_EXPIRY_SECONDS) =>
  getClient().presignedGetObject(
    process.env.MINIO_BUCKET,
    objectKey(fileName),
    expirySeconds
  )

const objectExists = async (fileName) => {
  if (!fileName) return false

  const cached = readCache(fileName)
  if (cached !== undefined) return cached

  try {
    await getClient().statObject(process.env.MINIO_BUCKET, objectKey(fileName))
    writeCache(fileName, true)
    return true
  } catch (error) {
    if (error.code === 'NotFound' || error.code === 'NoSuchKey') {
      writeCache(fileName, false)
      return false
    }
    throw error
  }
}

// The object is checked before a URL is handed out: a null tells the caller
// there is nothing to fetch, where a presigned link would simply 404 when
// clicked. Object storage being unreachable also yields null rather than
// failing the search around it.
const getResumeUrl = async (fileName, expirySeconds = RESUME_URL_EXPIRY_SECONDS) => {
  if (!fileName) return null

  try {
    if (!(await objectExists(fileName))) return null
    return await getPresignedUrl(fileName, expirySeconds)
  } catch (error) {
    console.error(`resume url failed for "${fileName}":`, error.message)
    return null
  }
}

export {
  getClient,
  getPresignedUrl,
  getResumeUrl,
  objectExists,
}
