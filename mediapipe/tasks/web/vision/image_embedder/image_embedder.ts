/**
 * Copyright 2022 The MediaPipe Authors. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {CalculatorGraphConfig} from '../../../../framework/calculator_pb';
import {CalculatorOptions} from '../../../../framework/calculator_options_pb';
import {EmbeddingResult} from '../../../../tasks/cc/components/containers/proto/embeddings_pb';
import {BaseOptions as BaseOptionsProto} from '../../../../tasks/cc/core/proto/base_options_pb';
import {ImageEmbedderGraphOptions} from '../../../../tasks/cc/vision/image_embedder/proto/image_embedder_graph_options_pb';
import {Embedding} from '../../../../tasks/web/components/containers/embedding_result';
import {convertEmbedderOptionsToProto} from '../../../../tasks/web/components/processors/embedder_options';
import {convertFromEmbeddingResultProto} from '../../../../tasks/web/components/processors/embedder_result';
import {computeCosineSimilarity} from '../../../../tasks/web/components/utils/cosine_similarity';
import {WasmFileset} from '../../../../tasks/web/core/wasm_fileset';
import {VisionTaskRunner} from '../../../../tasks/web/vision/core/vision_task_runner';
import {ImageSource, WasmModule} from '../../../../web/graph_runner/graph_runner';
// Placeholder for internal dependency on trusted resource url

import {ImageEmbedderOptions} from './image_embedder_options';
import {ImageEmbedderResult} from './image_embedder_result';

// The OSS JS API does not support the builder pattern.
// tslint:disable:jspb-use-builder-pattern

const INPUT_STREAM = 'image_in';
const EMBEDDINGS_STREAM = 'embeddings_out';
const TEXT_EMBEDDER_CALCULATOR =
    'mediapipe.tasks.vision.image_embedder.ImageEmbedderGraph';

export * from './image_embedder_options';
export * from './image_embedder_result';
export {ImageSource};  // Used in the public API

/** Performs embedding extraction on images. */
export class ImageEmbedder extends VisionTaskRunner<ImageEmbedderResult> {
  private readonly options = new ImageEmbedderGraphOptions();
  private embeddings: ImageEmbedderResult = {embeddings: []};

  /**
   * Initializes the Wasm runtime and creates a new image embedder from the
   * provided options.
   * @param wasmFileset A configuration object that provides the location of the
   *     Wasm binary and its loader.
   * @param imageEmbedderOptions The options for the image embedder. Note that
   *     either a path to the TFLite model or the model itself needs to be
   *     provided (via `baseOptions`).
   */
  static createFromOptions(
      wasmFileset: WasmFileset,
      imageEmbedderOptions: ImageEmbedderOptions): Promise<ImageEmbedder> {
    return VisionTaskRunner.createInstance(
        ImageEmbedder, /* initializeCanvas= */ true, wasmFileset,
        imageEmbedderOptions);
  }

  /**
   * Initializes the Wasm runtime and creates a new image embedder based on the
   * provided model asset buffer.
   * @param wasmFileset A configuration object that provides the location of the
   *     Wasm binary and its loader.
   * @param modelAssetBuffer A binary representation of the TFLite model.
   */
  static createFromModelBuffer(
      wasmFileset: WasmFileset,
      modelAssetBuffer: Uint8Array): Promise<ImageEmbedder> {
    return VisionTaskRunner.createInstance(
        ImageEmbedder, /* initializeCanvas= */ true, wasmFileset,
        {baseOptions: {modelAssetBuffer}});
  }

  /**
   * Initializes the Wasm runtime and creates a new image embedder based on the
   * path to the model asset.
   * @param wasmFileset A configuration object that provides the location of the
   *     Wasm binary and its loader.
   * @param modelAssetPath The path to the TFLite model.
   */
  static createFromModelPath(
      wasmFileset: WasmFileset,
      modelAssetPath: string): Promise<ImageEmbedder> {
    return VisionTaskRunner.createInstance(
        ImageEmbedder, /* initializeCanvas= */ true, wasmFileset,
        {baseOptions: {modelAssetPath}});
  }

  constructor(
      wasmModule: WasmModule,
      glCanvas?: HTMLCanvasElement|OffscreenCanvas|null) {
    super(wasmModule, glCanvas);
    this.options.setBaseOptions(new BaseOptionsProto());
  }

  protected override get baseOptions(): BaseOptionsProto {
    return this.options.getBaseOptions()!;
  }

  protected override set baseOptions(proto: BaseOptionsProto) {
    this.options.setBaseOptions(proto);
  }

  /**
   * Sets new options for the image embedder.
   *
   * Calling `setOptions()` with a subset of options only affects those options.
   * You can reset an option back to its default value by explicitly setting it
   * to `undefined`.
   *
   * @param options The options for the image embedder.
   */
  override async setOptions(options: ImageEmbedderOptions): Promise<void> {
    await super.setOptions(options);
    this.options.setEmbedderOptions(convertEmbedderOptionsToProto(
        options, this.options.getEmbedderOptions()));
    this.refreshGraph();
  }

  /**
   * Performs embedding extraction on the provided single image and waits
   * synchronously for the response. Only use this method when the
   * ImageEmbedder is created with running mode `image`.
   *
   * @param image The image to process.
   * @return The classification result of the image
   */
  embed(image: ImageSource): ImageEmbedderResult {
    return this.processImageData(image);
  }

  /**
   * Performs embedding extraction on the provided video frame and waits
   * synchronously for the response. Only use this method when the
   * ImageEmbedder is created with running mode `video`.
   *
   * @param imageFrame The image frame to process.
   * @param timestamp The timestamp of the current frame, in ms.
   * @return The classification result of the image
   */
  embedForVideo(imageFrame: ImageSource, timestamp: number):
      ImageEmbedderResult {
    return this.processVideoData(imageFrame, timestamp);
  }

  /**
   * Utility function to compute cosine similarity[1] between two `Embedding`
   * objects.
   *
   * [1]: https://en.wikipedia.org/wiki/Cosine_similarity
   *
   * @throws if the embeddings are of different types(float vs. quantized), have
   *     different sizes, or have an L2-norm of 0.
   */
  static cosineSimilarity(u: Embedding, v: Embedding): number {
    return computeCosineSimilarity(u, v);
  }

  /** Runs the embedding extraction and blocks on the response. */
  protected process(image: ImageSource, timestamp: number):
      ImageEmbedderResult {
    // Get embeddings by running our MediaPipe graph.
    this.graphRunner.addGpuBufferAsImageToStream(
        image, INPUT_STREAM, timestamp ?? performance.now());
    this.finishProcessing();
    return this.embeddings;
  }

  /**
   * Internal function for converting raw data into an embedding, and setting it
   * as our embeddings result.
   */
  private addJsImageEmdedding(binaryProto: Uint8Array): void {
    const embeddingResult = EmbeddingResult.deserializeBinary(binaryProto);
    this.embeddings = convertFromEmbeddingResultProto(embeddingResult);
  }

  /** Updates the MediaPipe graph configuration. */
  private refreshGraph(): void {
    const graphConfig = new CalculatorGraphConfig();
    graphConfig.addInputStream(INPUT_STREAM);
    graphConfig.addOutputStream(EMBEDDINGS_STREAM);

    const calculatorOptions = new CalculatorOptions();
    calculatorOptions.setExtension(ImageEmbedderGraphOptions.ext, this.options);

    const embedderNode = new CalculatorGraphConfig.Node();
    embedderNode.setCalculator(TEXT_EMBEDDER_CALCULATOR);
    embedderNode.addInputStream('IMAGE:' + INPUT_STREAM);
    embedderNode.addOutputStream('EMBEDDINGS:' + EMBEDDINGS_STREAM);
    embedderNode.setOptions(calculatorOptions);

    graphConfig.addNode(embedderNode);

    this.graphRunner.attachProtoListener(EMBEDDINGS_STREAM, binaryProto => {
      this.addJsImageEmdedding(binaryProto);
    });

    const binaryGraph = graphConfig.serializeBinary();
    this.setGraph(new Uint8Array(binaryGraph), /* isBinary= */ true);
  }
}


