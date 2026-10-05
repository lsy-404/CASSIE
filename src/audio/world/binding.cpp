#include <emscripten.h>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <new>
#include <memory>
#include <vector>

#include "world/cheaptrick.h"
#include "world/d4c.h"
#include "world/dio.h"
#include "world/stonemask.h"
#include "world/synthesis.h"

namespace {

constexpr int kSampleRate = 48000;
constexpr int kFramePeriodMs = 5;
constexpr int kMinSampleCount = 1440;
constexpr int kMaxSampleCount = 20 * kSampleRate;

enum ErrorCode {
  kNoError = 0,
  kInvalidArgument = 1,
  kInvalidSampleRate = 2,
  kTooShort = 3,
  kTooLong = 4,
  kInvalidAudio = 5,
  kInvalidFeature = 6,
  kAllocationFailure = 7,
  kProcessingFailure = 8,
};

int last_error = kNoError;

struct Analysis {
  int sample_count = 0;
  int sample_rate = kSampleRate;
  int frame_count = 0;
  int fft_size = 0;
  int bin_count = 0;
  std::vector<double> f0;
  std::vector<double> spectral;
  std::vector<double> aperiodicity;
};

bool IsFiniteRange(const double* values, int count, double lower, double upper) {
  for (int i = 0; i < count; ++i) {
    if (!std::isfinite(values[i]) || values[i] < lower || values[i] > upper) {
      return false;
    }
  }
  return true;
}

}  // namespace

extern "C" {

EMSCRIPTEN_KEEPALIVE int world_last_error() { return last_error; }

EMSCRIPTEN_KEEPALIVE void* world_analyze_f32(const float* pcm, int sample_count,
                                             int sample_rate) {
  last_error = kNoError;
  if (pcm == nullptr || sample_count <= 0) {
    last_error = kInvalidArgument;
    return nullptr;
  }
  if (sample_rate != kSampleRate) {
    last_error = kInvalidSampleRate;
    return nullptr;
  }
  if (sample_count < kMinSampleCount) {
    last_error = kTooShort;
    return nullptr;
  }
  if (sample_count > kMaxSampleCount) {
    last_error = kTooLong;
    return nullptr;
  }

  try {
    std::vector<double> input(static_cast<std::size_t>(sample_count));
    for (int i = 0; i < sample_count; ++i) {
      const float value = pcm[i];
      if (!std::isfinite(value) || std::abs(value) > 8.0f) {
        last_error = kInvalidAudio;
        return nullptr;
      }
      input[static_cast<std::size_t>(i)] = static_cast<double>(value);
    }

    DioOption dio_option = {};
    InitializeDioOption(&dio_option);
    dio_option.frame_period = kFramePeriodMs;
    dio_option.speed = 1;
    dio_option.f0_floor = 40.0;
    const int frame_count = GetSamplesForDIO(sample_rate, sample_count,
                                              kFramePeriodMs);
    if (frame_count < 2) {
      last_error = kTooShort;
      return nullptr;
    }

    auto analysis = std::make_unique<Analysis>();
    analysis->sample_count = sample_count;
    analysis->frame_count = frame_count;
    analysis->f0.resize(static_cast<std::size_t>(frame_count));
    std::vector<double> time_axis(static_cast<std::size_t>(frame_count));
    std::vector<double> refined_f0(static_cast<std::size_t>(frame_count));
    Dio(input.data(), sample_count, sample_rate, &dio_option, time_axis.data(),
        analysis->f0.data());
    StoneMask(input.data(), sample_count, sample_rate, time_axis.data(),
              analysis->f0.data(), frame_count, refined_f0.data());
    analysis->f0.swap(refined_f0);

    CheapTrickOption spectral_option = {};
    InitializeCheapTrickOption(sample_rate, &spectral_option);
    spectral_option.f0_floor = 71.0;
    spectral_option.fft_size = GetFFTSizeForCheapTrick(sample_rate,
                                                        &spectral_option);
    analysis->fft_size = spectral_option.fft_size;
    analysis->bin_count = spectral_option.fft_size / 2 + 1;
    const std::size_t matrix_size = static_cast<std::size_t>(frame_count) *
                                    static_cast<std::size_t>(analysis->bin_count);
    analysis->spectral.resize(matrix_size);
    analysis->aperiodicity.resize(matrix_size);
    std::vector<double*> spectral_rows(static_cast<std::size_t>(frame_count));
    std::vector<double*> aperiodicity_rows(static_cast<std::size_t>(frame_count));
    for (int frame = 0; frame < frame_count; ++frame) {
      const std::size_t offset = static_cast<std::size_t>(frame) *
                                 static_cast<std::size_t>(analysis->bin_count);
      spectral_rows[static_cast<std::size_t>(frame)] =
          analysis->spectral.data() + offset;
      aperiodicity_rows[static_cast<std::size_t>(frame)] =
          analysis->aperiodicity.data() + offset;
    }

    CheapTrick(input.data(), sample_count, sample_rate, time_axis.data(),
               analysis->f0.data(), frame_count, &spectral_option,
               spectral_rows.data());

    D4COption d4c_option = {};
    InitializeD4COption(&d4c_option);
    d4c_option.threshold = 0.85;
    D4C(input.data(), sample_count, sample_rate, time_axis.data(),
        analysis->f0.data(), frame_count, analysis->fft_size, &d4c_option,
        aperiodicity_rows.data());
    return analysis.release();
  } catch (const std::bad_alloc&) {
    last_error = kAllocationFailure;
  } catch (...) {
    last_error = kProcessingFailure;
  }
  return nullptr;
}

EMSCRIPTEN_KEEPALIVE void world_destroy_analysis(void* handle) {
  delete static_cast<Analysis*>(handle);
}

EMSCRIPTEN_KEEPALIVE int world_sample_count(const void* handle) {
  return handle == nullptr ? 0 : static_cast<const Analysis*>(handle)->sample_count;
}

EMSCRIPTEN_KEEPALIVE int world_sample_rate(const void* handle) {
  return handle == nullptr ? 0 : static_cast<const Analysis*>(handle)->sample_rate;
}

EMSCRIPTEN_KEEPALIVE int world_frame_count(const void* handle) {
  return handle == nullptr ? 0 : static_cast<const Analysis*>(handle)->frame_count;
}

EMSCRIPTEN_KEEPALIVE int world_fft_size(const void* handle) {
  return handle == nullptr ? 0 : static_cast<const Analysis*>(handle)->fft_size;
}

EMSCRIPTEN_KEEPALIVE int world_bin_count(const void* handle) {
  return handle == nullptr ? 0 : static_cast<const Analysis*>(handle)->bin_count;
}

EMSCRIPTEN_KEEPALIVE int world_frame_period_ms() { return kFramePeriodMs; }

EMSCRIPTEN_KEEPALIVE const double* world_f0_ptr(const void* handle) {
  return handle == nullptr ? nullptr : static_cast<const Analysis*>(handle)->f0.data();
}

EMSCRIPTEN_KEEPALIVE const double* world_spectral_ptr(const void* handle) {
  return handle == nullptr ? nullptr : static_cast<const Analysis*>(handle)->spectral.data();
}

EMSCRIPTEN_KEEPALIVE const double* world_aperiodicity_ptr(const void* handle) {
  return handle == nullptr ? nullptr : static_cast<const Analysis*>(handle)->aperiodicity.data();
}

EMSCRIPTEN_KEEPALIVE int world_synthesize_f32(const void* handle,
                                               const double* f0,
                                               const double* spectral,
                                               const double* aperiodicity,
                                               float* output,
                                               int output_count) {
  last_error = kNoError;
  if (handle == nullptr || f0 == nullptr || spectral == nullptr ||
      aperiodicity == nullptr || output == nullptr) {
    last_error = kInvalidArgument;
    return last_error;
  }
  const auto* analysis = static_cast<const Analysis*>(handle);
  if (output_count != analysis->sample_count) {
    last_error = kInvalidArgument;
    return last_error;
  }
  const int feature_count = analysis->frame_count;
  const int matrix_count = feature_count * analysis->bin_count;
  if (!IsFiniteRange(f0, feature_count, 0.0, 2000.0) ||
      !IsFiniteRange(spectral, matrix_count, 0.0, 1.0e12) ||
      !IsFiniteRange(aperiodicity, matrix_count, 0.0, 1.0)) {
    last_error = kInvalidFeature;
    return last_error;
  }

  try {
    const int synthesis_count = analysis->sample_count;
    std::vector<double> pcm(static_cast<std::size_t>(synthesis_count));
    std::vector<const double*> spectral_rows(static_cast<std::size_t>(feature_count));
    std::vector<const double*> aperiodicity_rows(static_cast<std::size_t>(feature_count));
    for (int frame = 0; frame < feature_count; ++frame) {
      const std::size_t offset = static_cast<std::size_t>(frame) *
                                 static_cast<std::size_t>(analysis->bin_count);
      spectral_rows[static_cast<std::size_t>(frame)] = spectral + offset;
      aperiodicity_rows[static_cast<std::size_t>(frame)] = aperiodicity + offset;
    }
    Synthesis(f0, feature_count, spectral_rows.data(), aperiodicity_rows.data(),
              analysis->fft_size, static_cast<double>(kFramePeriodMs),
              analysis->sample_rate, synthesis_count, pcm.data());

    const int copied_count = std::min(synthesis_count, output_count);
    for (int i = 0; i < copied_count; ++i) {
      if (!std::isfinite(pcm[static_cast<std::size_t>(i)]) ||
          std::abs(pcm[static_cast<std::size_t>(i)]) > 32.0) {
        last_error = kProcessingFailure;
        return last_error;
      }
      output[i] = static_cast<float>(pcm[static_cast<std::size_t>(i)]);
    }
    std::fill(output + copied_count, output + output_count, 0.0f);
    return kNoError;
  } catch (const std::bad_alloc&) {
    last_error = kAllocationFailure;
  } catch (...) {
    last_error = kProcessingFailure;
  }
  return last_error;
}

}
