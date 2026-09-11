package main

import (
	"hash/fnv"
	"time"
)

// Payers have no identity in Railway's data, only a billing rhythm, so a
// chain is named from the two things that never change about it: its
// template and its first invoice. The same deployer gets the same name on
// every recompute; a lapsed deployer who comes back starts a new chain and
// therefore a new name.
var (
	nameAdjectives = []string{
		"amber", "brisk", "calm", "candid", "clever", "cobalt", "coral", "crisp",
		"daring", "dusky", "eager", "fabled", "gentle", "gilded", "hardy", "hazel",
		"humble", "indigo", "jolly", "keen", "lively", "lucid", "mellow", "merry",
		"misty", "noble", "olive", "patient", "plucky", "quiet", "rosy", "rustic",
		"sable", "sage", "scarlet", "silver", "sturdy", "sunny", "tidy", "vivid",
	}
	nameAnimals = []string{
		"badger", "bison", "crane", "dolphin", "falcon", "ferret", "finch", "gecko",
		"heron", "ibis", "jackal", "kestrel", "koala", "lemur", "lynx", "marten",
		"moose", "narwhal", "newt", "ocelot", "orca", "osprey", "otter", "panda",
		"pelican", "puffin", "quail", "raven", "seal", "sparrow", "stoat", "tapir",
		"toucan", "turtle", "viper", "walrus", "weasel", "wombat", "yak", "zebra",
	}
)

func payerName(templateID string, firstAt time.Time) string {
	h := fnv.New64a()
	h.Write([]byte(templateID))
	h.Write([]byte(firstAt.UTC().Format(time.RFC3339)))
	sum := h.Sum64()
	adj := nameAdjectives[sum%uint64(len(nameAdjectives))]
	animal := nameAnimals[(sum/uint64(len(nameAdjectives)))%uint64(len(nameAnimals))]
	return adj + " " + animal
}
