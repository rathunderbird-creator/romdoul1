/**
 * Reads an image file, center-crops it to a 1:1 square aspect ratio, resizes it to a specific dimension
 * (e.g., 500x500 pixels by default) and encodes it as a compressed JPEG Blob.
 */
export async function processImageForUpload(file: File, options = { width: 500, quality: 0.85 }): Promise<Blob> {
    return new Promise((resolve, reject) => {
        // Only accept images
        if (!file.type.startsWith('image/')) {
            return reject(new Error('File is not an image'));
        }

        const reader = new FileReader();

        reader.onload = (readerEvent) => {
            const image = new Image();
            image.onload = () => {
                const canvas = document.createElement('canvas');

                // Calculate size for center cropping (square 1:1 ratio)
                let sourceSize;
                let sourceX = 0;
                let sourceY = 0;

                if (image.width > image.height) {
                    sourceSize = image.height;
                    sourceX = (image.width - image.height) / 2;
                } else {
                    sourceSize = image.width;
                    sourceY = (image.height - image.width) / 2;
                }

                // Desired output dimensions (e.g. 500x500)
                canvas.width = options.width;
                canvas.height = options.width;

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    return reject(new Error('Canvas context not supported'));
                }

                // Draw the specific cropped area onto the full canvas width/height
                ctx.fillStyle = '#FFFFFF'; // Fill background white in case of transparent PNGs
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(
                    image,
                    sourceX, sourceY, sourceSize, sourceSize, // Source (x, y, w, h)
                    0, 0, canvas.width, canvas.height       // Destination (x, y, w, h)
                );

                // Convert canvas back to a Blob (JPEG compressed)
                canvas.toBlob((blob) => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error('Canvas to Blob conversion failed'));
                    }
                }, 'image/jpeg', options.quality); // Target 85% JPEG Quality
            };

            image.onerror = () => reject(new Error('Image load failed'));

            if (readerEvent.target?.result) {
                image.src = readerEvent.target.result as string;
            } else {
                reject(new Error('FileReader result is empty'));
            }
        };

        reader.onerror = () => reject(new Error('FileReader failed'));
        reader.readAsDataURL(file);
    });
}
