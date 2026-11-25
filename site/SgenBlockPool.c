#include <emscripten/emscripten.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#if !defined(__wasm32__) || defined(__EMSCRIPTEN_PTHREADS__)
#error The SGen block pool requires single-threaded wasm32.
#endif

// Mono 11 requests aligned major-heap blocks individually in single-threaded wasm32.
// Group those exact requests to reduce alignment gaps in the linear heap.
enum { BlockSize = 16 * 1024, BlocksPerSlab = 32, SlabSize = BlockSize * BlocksPerSlab };
enum { PageMapSize = UINT32_MAX / BlockSize + 1 };

struct Slab {
    unsigned char *base;
    uint32_t available;
    struct Slab *previous;
    struct Slab *next;
};

static struct Slab *pages[PageMapSize];
static struct Slab *available;
static unsigned allocations;
static int pool_enabled;

EMSCRIPTEN_KEEPALIVE void ioextend_set_sgen_pool(int enabled)
{
    pool_enabled = enabled;
}

void *__real_sgen_alloc_os_memory_aligned(size_t, uintptr_t, int, const char *, int);
void __real_sgen_free_os_memory(void *, size_t, int, int);

static void add_available(struct Slab *slab)
{
    slab->previous = NULL;
    slab->next = available;
    if (available)
        available->previous = slab;
    available = slab;
}

static void remove_available(struct Slab *slab)
{
    if (slab->previous)
        slab->previous->next = slab->next;
    else
        available = slab->next;
    if (slab->next)
        slab->next->previous = slab->previous;
}

void *__wrap_sgen_alloc_os_memory_aligned(size_t size, uintptr_t alignment, int flags,
                                         const char *description, int account_type)
{
    if (!pool_enabled || size != BlockSize || alignment != BlockSize ||
        !description || strcmp(description, "major heap section") != 0)
        return __real_sgen_alloc_os_memory_aligned(size, alignment, flags, description, account_type);

    if (!available) {
        struct Slab *slab = malloc(sizeof(*slab));
        if (!slab)
            return __real_sgen_alloc_os_memory_aligned(size, alignment, flags, description, account_type);

        slab->base = __real_sgen_alloc_os_memory_aligned(SlabSize, BlockSize, flags, NULL, account_type);
        if (!slab->base) {
            free(slab);
            return __real_sgen_alloc_os_memory_aligned(size, alignment, flags, description, account_type);
        }
        slab->available = UINT32_MAX;
        unsigned first_page = (uintptr_t)slab->base / BlockSize;
        for (unsigned index = 0; index < BlocksPerSlab; index++)
            pages[first_page + index] = slab;
        add_available(slab);
    }

    struct Slab *slab = available;
    unsigned index = __builtin_ctz(slab->available);
    slab->available &= ~(UINT32_C(1) << index);
    if (!slab->available)
        remove_available(slab);

    void *block = slab->base + index * BlockSize;
    memset(block, 0, BlockSize);
    if (allocations++ == 0)
        puts("IOExtend SGen aligned block pool active.");
    return block;
}

void __wrap_sgen_free_os_memory(void *block, size_t size, int flags, int account_type)
{
    uintptr_t address = (uintptr_t)block;
    struct Slab *slab = size == BlockSize && address % BlockSize == 0 ? pages[address / BlockSize] : NULL;
    if (!slab) {
        __real_sgen_free_os_memory(block, size, flags, account_type);
        return;
    }

    unsigned index = (address - (uintptr_t)slab->base) / BlockSize;
    uint32_t bit = UINT32_C(1) << index;
    if (slab->available & bit)
        abort();
    if (!slab->available)
        add_available(slab);
    slab->available |= bit;
    if (slab->available != UINT32_MAX)
        return;

    remove_available(slab);
    unsigned first_page = (uintptr_t)slab->base / BlockSize;
    for (unsigned slot = 0; slot < BlocksPerSlab; slot++)
        pages[first_page + slot] = NULL;
    __real_sgen_free_os_memory(slab->base, SlabSize, flags, account_type);
    free(slab);
}
