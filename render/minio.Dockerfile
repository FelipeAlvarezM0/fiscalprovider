FROM minio/minio:latest

CMD ["server", "/data", "--address", ":10000"]
