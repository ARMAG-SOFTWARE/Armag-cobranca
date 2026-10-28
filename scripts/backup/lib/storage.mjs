import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

/**
 * Cloudflare R2 é S3-compatível — o SDK padrão da AWS funciona apontando
 * `endpoint` para a conta R2. Credenciais aqui são as do TOKEN DE API DO
 * R2 (escopo restrito a um único bucket), sempre diferentes das
 * credenciais do Supabase — se uma vazar, a outra continua protegida.
 */
export function createStorageClient({ accountId, accessKeyId, secretAccessKey }) {
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

export async function uploadObject(client, bucket, key, body) {
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
}

/** Confirma que o objeto existe no destino e tem o tamanho esperado — nunca supõe que um upload sem erro = upload correto. */
export async function verifyUpload(client, bucket, key, expectedSizeBytes) {
  const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  if (head.ContentLength !== expectedSizeBytes) {
    throw new Error(
      `Tamanho do objeto em ${key} (${head.ContentLength}) não bate com o esperado (${expectedSizeBytes}).`,
    );
  }
}

/** Cópia do lado do servidor (sem baixar/reenviar) — usada para alimentar as camadas diária/mensal sem duplicar processamento. */
export async function copyObject(client, bucket, sourceKey, destKey) {
  await client.send(
    new CopyObjectCommand({ Bucket: bucket, CopySource: `${bucket}/${sourceKey}`, Key: destKey }),
  );
}

export async function listObjects(client, bucket, prefix) {
  const objects = [];
  let continuationToken;
  do {
    const response = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken }),
    );
    for (const item of response.Contents ?? []) {
      if (item.Key && item.LastModified) objects.push({ key: item.Key, lastModified: item.LastModified });
    }
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);
  return objects;
}

export async function deleteObject(client, bucket, key) {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
