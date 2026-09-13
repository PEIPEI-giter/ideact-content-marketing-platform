type RecordWithImages<Image> = {
  id: string;
  copy?: { key: string; generatedAt: string };
  images: Image[];
};

export function appendImageToRecord<Image, RecordItem extends RecordWithImages<Image>>(
  records: RecordItem[],
  copyKey: string,
  copyGeneratedAt: string,
  image: Image,
): RecordItem[] {
  return records.map((record) =>
    record.copy?.key === copyKey && record.copy.generatedAt === copyGeneratedAt
      ? { ...record, images: [image, ...record.images] }
      : record,
  );
}

export function deleteProductionRecord<RecordItem extends { id: string }>(records: RecordItem[], id: string): RecordItem[] {
  return records.filter((record) => record.id !== id);
}
