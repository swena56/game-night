"""Key Clash's own word lists (#382): familiar words by theme, on top of the everyday words Word Ladder and Word
Garden use. Every word is checked against data/words.txt when the lists load (keyclash.themes), so a slip here
can't put a non-word in front of a typist."""

THEMES = {
    "animals": """
        ant ape bat bear bee bird boar buck bull calf camel cat cheetah chick chicken clam cobra colt cougar cow coyote crab
        crane crow cub deer dingo dog dolphin donkey dove dragonfly duck eagle eel elephant elk emu falcon ferret finch fish
        flamingo fly fox frog gazelle gecko gerbil giraffe gnat goat goose gorilla grasshopper gull hamster hare hawk hedgehog
        hen heron hippo hornet horse hound hyena ibis iguana jackal jaguar jay jellyfish kangaroo kitten koala lamb lark
        leopard lion lizard llama lobster lynx macaw magpie mammoth manatee mink mole monkey moose mosquito moth mouse mule
        newt octopus ostrich otter owl ox oyster panda panther parrot peacock pelican penguin pig pigeon platypus pony
        porcupine possum puffin puma puppy python quail rabbit raccoon ram rat raven reindeer rhino robin rooster salmon
        scorpion seahorse seal shark sheep shrimp skunk sloth slug snail snake sparrow spider squid squirrel stallion
        starfish stork swan tadpole tiger toad tortoise toucan trout tuna turkey turtle viper vulture walrus wasp weasel
        whale wolf wombat woodpecker worm yak zebra antelope armadillo badger beaver beetle bison buffalo butterfly
        canary caterpillar chameleon chimpanzee chipmunk cricket crocodile dragon flounder goldfish grizzly hummingbird
        ladybug lemur mackerel meerkat mongoose narwhal nightingale orangutan pheasant piglet poodle rattlesnake sardine
        stingray terrier tarantula wildcat wolverine alpaca beagle bulldog collie dachshund husky mastiff spaniel
    """,
    "food": """
        apple apricot avocado bacon bagel banana barley basil bean beef berry biscuit bread broccoli brownie butter cabbage
        cake candy carrot cashew celery cereal cheese cherry chicken chili chips chocolate cinnamon clam coconut coffee
        cookie corn cracker cream crepe croissant cucumber cupcake curry custard date donut dumpling egg eggplant fig flour
        fudge garlic ginger grape grapefruit gravy ham hamburger honey hotdog jam jelly juice kale ketchup kiwi lamb lasagna
        lemon lemonade lettuce lime lobster mango maple melon milk mint muffin mushroom mustard noodle nutmeg oat olive
        omelet onion orange pancake papaya pasta pastry peach peanut pear pea pecan pepper pickle pie pineapple pizza plum
        popcorn pork porridge potato pretzel pudding pumpkin radish raisin raspberry rice roast salad salami salmon salsa
        salt sandwich sauce sausage scone soup spaghetti spinach squash steak stew strawberry sugar sushi syrup taco tea
        toast tofu tomato tortilla truffle tuna turkey vanilla vinegar waffle walnut watermelon yogurt zucchini almond
        blueberry broth burrito caramel casserole cheddar chowder cobbler cranberry dessert gingerbread granola hazelnut
        lollipop macaroni marshmallow meatball mozzarella nachos oatmeal parsley peppermint pistachio popsicle ravioli
        sherbet smoothie sundae tangerine teriyaki toffee turnip wafer
    """,
    "nature": """
        acorn autumn bay beach blizzard blossom bloom boulder branch breeze brook bush canyon cave cedar cliff cloud coast
        coral creek crystal current daisy dawn desert dew dune dusk earth ember fern field flame flood flower fog forest
        frost galaxy garden glacier grass gravel grove gust hail harbor harvest hill horizon island ivy jungle lagoon lake
        leaf lightning lily marsh meadow mist moon moss mountain mud oak ocean orchid palm pebble petal pine planet plain
        pond poppy prairie puddle rain rainbow reef ridge river rock rose sand sea season seed shade shore sky sleet snow
        snowflake soil spring spruce star stone storm stream summit sun sunrise sunset swamp thicket thorn thunder tide
        timber tornado trail tree tulip tundra twig valley vine volcano wave weather willow wind winter wood acorn
        avalanche bamboo blossom cactus canopy cascade cherry clover cyclone dandelion drizzle eclipse equator evergreen
        firefly geyser hurricane iceberg lavender maple meteor monsoon moonlight orchard peninsula plateau rainforest
        sapling seashell shoreline sunflower sunshine thunderstorm volcano waterfall wildflower wilderness woodland
    """,
    "science": """
        acid atom axis battery beaker biology cable carbon cell chip circuit climate code comet compass computer copper
        cosmos crater data device diode distance electron element energy engine enzyme experiment fossil formula friction
        fuel gear gene genome gravity heat helium hydrogen keyboard laser lens lever light liquid magnet mass matter metal
        meteor microscope mineral modem molecule monitor motion motor neuron neutron nucleus orbit organ oxygen particle
        physics pixel planet plasma pressure prism program proton pulley quantum radar radio robot rocket satellite
        science sensor signal software solar sound spectrum speed spring static steam sugar telescope theory thermometer
        tissue tool vaccine vacuum velocity virus voltage volume water watt wave wire algebra algorithm antenna asteroid
        astronaut bacteria browser calculus capsule chemical compound database digital equation galaxy geometry hardware
        internet invention laboratory magnetic mechanic microchip network nitrogen nebula observatory password processor
        research spaceship structure supernova technology telescope transistor universe wireless
    """,
    "sports": """
        ace archery arena athlete badminton ball base baseball basket basketball bat bike boxing bowling bunt captain catch
        champion cheer chess climb coach court cricket cycling dart defense diamond dice dive dodge dribble field fencing
        finish fitness football foul game glove goal golf gym helmet hockey hoop hurdle inning jersey jog judo jump karate
        kick lacrosse lane league marathon match medal net offense olympic paddle pass pitch player podium point puck punch
        putt quarter race racket rally referee relay rink rowing rugby run sailing score serve skate skating ski sled
        snowboard soccer spike sprint squash stadium surf swim swimming tackle target team tennis throw tournament track
        trophy umpire volley volleyball whistle wrestling yoga checkers cards poker puzzle domino marble kite skateboard
        frisbee jigsaw backgammon billiards bingo crossword scrabble trampoline treadmill triathlon
    """,
    "home": """
        attic basement bath bathtub bed bedroom bench blanket blender bookcase bottle bowl broom bucket cabinet candle
        carpet ceiling chair chimney closet clock couch counter cup cupboard curtain cushion desk dish door drawer dryer
        faucet fence floor fork freezer fridge furnace garage gate glass hallway hammer hanger hose iron jar kettle key
        kitchen ladder lamp laundry lawn lock mailbox mat mattress microwave mirror mop mug napkin oven pan pantry pillow
        plate plug porch pot quilt radio roof rug saucer scissors shelf shower sink sofa spoon stairs stool stove table
        teapot television toaster toilet towel tray vase wall wardrobe window yard apron bookshelf chandelier doorbell
        dishwasher fireplace flashlight lampshade nightstand ornament paintbrush stapler suitcase thermostat toothbrush
        umbrella vacuum wallpaper wheelbarrow windowsill
    """,
}
THEME_NAMES = {"mixed": "🌈 Everything", "animals": "🐾 Animals", "food": "🍕 Food", "nature": "🌲 Nature",
               "science": "🔬 Science & tech", "sports": "⚽ Sports & games", "home": "🏠 Around the house"}
