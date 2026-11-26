/**
 * @module tests/helpers/media-dir
 * Jest runs this before each test file: image files go to a temporary folder
 * of the file's own, so the tests never write into the project's media/ and
 * two files running at once never share one (3b).
 */

import { tmpdir } from 'os';
import { join } from 'path';

process.env.MEDIA_DIR = join(tmpdir(), `miseenplace-test-media-${process.pid}-${process.env.JEST_WORKER_ID ?? '0'}`);
