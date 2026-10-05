cmake_minimum_required(VERSION 3.20)
project(cassie_world_wasm LANGUAGES CXX)

if(NOT EMSCRIPTEN)
  message(FATAL_ERROR "Build this target with emcmake and Emscripten 6.0.10")
endif()

if(NOT EMSCRIPTEN_VERSION VERSION_EQUAL "6.0.10")
  message(FATAL_ERROR "Expected Emscripten 6.0.10, got ${EMSCRIPTEN_VERSION}")
endif()

add_subdirectory(vendor "${CMAKE_CURRENT_BINARY_DIR}/world")

add_executable(cassie_world binding.cpp)
target_compile_features(cassie_world PRIVATE cxx_std_17)
target_include_directories(cassie_world PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/vendor/src")
target_link_libraries(cassie_world PRIVATE world::core)
set_target_properties(cassie_world PROPERTIES OUTPUT_NAME "world" SUFFIX ".mjs")
target_compile_options(world PRIVATE -fexceptions)
target_compile_options(cassie_world PRIVATE -O3 -Wall -Wextra -Wconversion -fexceptions)
target_link_options(cassie_world PRIVATE
  "-sMODULARIZE=1"
  "-sEXPORT_ES6=1"
  "-sEXPORT_NAME=createWorldModule"
  "-sENVIRONMENT=web,worker,node"
  "-sFILESYSTEM=0"
  "-sALLOW_MEMORY_GROWTH=1"
  "-sINITIAL_MEMORY=67108864"
  "-sMAXIMUM_MEMORY=268435456"
  "-sEXPORTED_FUNCTIONS=['_malloc','_free']"
  "-sEXPORTED_RUNTIME_METHODS=['HEAPF32','HEAPF64']"
  "-fexceptions"
  "-sDISABLE_EXCEPTION_CATCHING=0"
)
